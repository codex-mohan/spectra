import type { Agent } from '@mohanscodex/spectra-agent';
import type { Message } from '@mohanscodex/spectra-ai';
import type { SecurityManager } from '../security/index.js';
import type { SessionStore, SessionData } from './session-store.js';
import type { ChatMessage } from '../tui/types.js';
import type { AgentRegistryConfig } from '../agents/registry.js';
import type { CustomProviderConfig } from './config.js';

export type SessionStatus = 'idle' | 'busy' | 'error';

export interface SessionState {
	id: string;
	agent: Agent | null;
	messages: ChatMessage[];
	status: SessionStatus;
	abortController: AbortController | null;
	isStreaming: boolean;
	agentKey: string | null;
	securityManager: SecurityManager | null;
	loadedMessages: Message[];
}

export type SessionEventType = 'status_change' | 'messages_update' | 'error';

export interface SessionEvent {
	type: SessionEventType;
	sessionId: string;
	status?: SessionStatus;
	messages?: ChatMessage[];
	error?: string;
}

type SessionEventHandler = (event: SessionEvent) => void;

export class SessionManager {
	private sessions = new Map<string, SessionState>();
	private eventHandlers: SessionEventHandler[] = [];
	private activeSessionId: string | null = null;

	constructor(
		private sessionStore: SessionStore,
		private agentFactory: (
			model: string,
			provider: string,
			agent: string,
			customProviders: Record<string, CustomProviderConfig>,
			thinkingEffort: string | undefined,
			securityManager: SecurityManager,
		) => Promise<{ agent: Agent; config: AgentRegistryConfig; securityManager: SecurityManager }>,
		private createSecurityManager: () => SecurityManager,
	) {}

	onEvent(handler: SessionEventHandler): () => void {
		this.eventHandlers.push(handler);
		return () => {
			const idx = this.eventHandlers.indexOf(handler);
			if (idx >= 0) this.eventHandlers.splice(idx, 1);
		};
	}

	private emit(event: SessionEvent) {
		for (const handler of this.eventHandlers) {
			try { handler(event); } catch {}
		}
	}

	getSession(id: string): SessionState | undefined {
		return this.sessions.get(id);
	}

	getActiveSession(): SessionState | undefined {
		return this.activeSessionId ? this.sessions.get(this.activeSessionId) : undefined;
	}

	getActiveSessionId(): string | null {
		return this.activeSessionId;
	}

	setActiveSession(id: string | null) {
		this.activeSessionId = id;
	}

	getAllSessions(): SessionState[] {
		return Array.from(this.sessions.values());
	}

	getBusySessions(): SessionState[] {
		return Array.from(this.sessions.values()).filter((s) => s.status === 'busy');
	}

	createSession(id?: string): SessionState {
		const sessionId = id || this.generateId();
		const state: SessionState = {
			id: sessionId,
			agent: null,
			messages: [],
			status: 'idle',
			abortController: null,
			isStreaming: false,
			agentKey: null,
			securityManager: null,
			loadedMessages: [],
		};
		this.sessions.set(sessionId, state);
		return state;
	}

	loadSession(sessionData: SessionData): SessionState {
		const existing = this.sessions.get(sessionData.id);
		if (existing) return existing;

		const state: SessionState = {
			id: sessionData.id,
			agent: null,
			messages: [],
			status: 'idle',
			abortController: null,
			isStreaming: false,
			agentKey: null,
			securityManager: null,
			loadedMessages: sessionData.messages as unknown as Message[],
		};
		this.sessions.set(sessionData.id, state);
		return state;
	}

	removeSession(id: string) {
		const state = this.sessions.get(id);
		if (state) {
			state.abortController?.abort();
			this.sessions.delete(id);
			if (this.activeSessionId === id) {
				this.activeSessionId = null;
			}
		}
	}

	cancelSession(id: string) {
		const state = this.sessions.get(id);
		if (state?.abortController) {
			state.abortController.abort();
			state.abortController = null;
			state.isStreaming = false;
			state.status = 'idle';
			this.emit({ type: 'status_change', sessionId: id, status: 'idle' });
		}
	}

	cancelAll() {
		for (const [id] of this.sessions) {
			this.cancelSession(id);
		}
	}

	async ensureAgent(
		sessionId: string,
		model: string,
		provider: string,
		agentName: string,
		customProviders: Record<string, CustomProviderConfig>,
		thinkingEffort: string | undefined,
	): Promise<Agent> {
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = this.createSession(sessionId);
		}

		const agentKey = `${agentName}:${model}:${provider}:${thinkingEffort || ''}`;
		if (state.agent && state.agentKey === agentKey) {
			return state.agent;
		}

		const securityManager = state.securityManager || this.createSecurityManager();
		const result = await this.agentFactory(model, provider, agentName, customProviders, thinkingEffort, securityManager);

		state.agent = result.agent;
		state.agentKey = agentKey;
		state.securityManager = result.securityManager;

		if (state.loadedMessages.length > 0) {
			result.agent.restoreHistory(state.loadedMessages);
			state.loadedMessages = [];
		}

		return result.agent;
	}

	async runPrompt(
		sessionId: string,
		prompt: string,
		options: {
			model: string;
			provider: string;
			agent: string;
			customProviders: Record<string, CustomProviderConfig>;
			thinkingEffort: string | undefined;
			onMessageStart?: (msgId: string) => void;
			onMessageUpdate?: (msgId: string, content: string, blocks: any[]) => void;
			onMessageEnd?: (msgId: string, msg: any) => void;
			onToolStart?: (toolCallId: string, name: string, args: unknown) => void;
			onToolEnd?: (toolCallId: string, result: any, isError: boolean) => void;
			onAgentEnd?: () => void;
		},
	): Promise<void> {
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = this.createSession(sessionId);
		}

		if (state.isStreaming) {
			return;
		}

		const agent = await this.ensureAgent(
			sessionId,
			options.model,
			options.provider,
			options.agent,
			options.customProviders,
			options.thinkingEffort,
		);

		const abortController = new AbortController();
		state.abortController = abortController;
		state.isStreaming = true;
		state.status = 'busy';
		this.emit({ type: 'status_change', sessionId, status: 'busy' });

		try {
			for await (const ev of agent.run(prompt)) {
				if (abortController.signal.aborted) break;

				if (ev.type === 'message_start' && ev.message.role === 'assistant') {
					options.onMessageStart?.('');
				}
				if (ev.type === 'message_update' && ev.message.role === 'assistant') {
					options.onMessageUpdate?.('', '', []);
				}
				if (ev.type === 'message_end' && ev.message.role === 'assistant') {
					options.onMessageEnd?.('', ev.message);
				}
				if (ev.type === 'tool_execution_start') {
					options.onToolStart?.(ev.toolCallId, ev.toolName, ev.args);
				}
				if (ev.type === 'tool_execution_end') {
					options.onToolEnd?.(ev.toolCallId, ev.result, ev.isError || false);
				}
				if (ev.type === 'agent_end') {
					options.onAgentEnd?.();
				}
			}
		} catch (err) {
			state.status = 'error';
			this.emit({ type: 'error', sessionId, error: err instanceof Error ? err.message : String(err) });
		} finally {
			state.isStreaming = false;
			state.abortController = null;
			state.status = 'idle';
			this.emit({ type: 'status_change', sessionId, status: 'idle' });
		}
	}

	private generateId(): string {
		return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
	}
}
