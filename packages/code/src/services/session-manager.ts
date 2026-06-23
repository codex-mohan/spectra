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
	customProviders?: Record<string, CustomProviderConfig>;
	thinkingEffort?: string;
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
			sessionId?: string,
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
		const result = await this.agentFactory(model, provider, agentName, customProviders, thinkingEffort, securityManager, sessionId);

		state.agent = result.agent;
		state.agentKey = agentKey;
		state.securityManager = result.securityManager;
		state.customProviders = customProviders;
		state.thinkingEffort = thinkingEffort;

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

		let abortedMidStream = false;
		try {
			for await (const ev of agent.run(prompt)) {
				if (abortController.signal.aborted) {
					abortedMidStream = true;
					break;
				}

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
			if (abortedMidStream) {
				this.handleInterrupt(agent, sessionId);
			}
			state.isStreaming = false;
			state.abortController = null;
			state.status = 'idle';
			this.emit({ type: 'status_change', sessionId, status: 'idle' });
		}
	}

	injectBackgroundResult(
		parentSessionId: string,
		childSessionId: string,
		result: string,
		agentType: string,
		description: string,
	): void {
		const state = this.sessions.get(parentSessionId);
		if (!state) return;

		const summaryText = result || '(no output)';
		const syntheticMessage: Message = {
			role: 'user',
			content: [
				`<task id="${childSessionId}" state="completed">`,
				`<summary>Background task completed: ${description}</summary>`,
				`<agent>${agentType}</agent>`,
				`<task_result>${summaryText}</task_result>`,
				`</task>`,
			].join('\n'),
			timestamp: Date.now(),
		};

		this.sessionStore.addMessage(parentSessionId, syntheticMessage);

		// If parent is idle, trigger a new agent turn so it can act on the result
		if (state.status === 'idle' && state.agent && !state.isStreaming) {
			const parts = state.agentKey?.split(':') || [];
			const agentName = parts[0] || 'build';
			const model = parts[1] || '';
			const provider = parts[2] || '';
			this.runPrompt(parentSessionId, '[Background task completed]', {
				model,
				provider,
				agent: agentName,
				customProviders: state.customProviders || {},
				thinkingEffort: parts[3] || undefined,
			}).catch(() => {});
		}
	}

	private handleInterrupt(agent: Agent, sessionId: string): void {
		const msgs = agent.messages;
		if (msgs.length === 0) return;

		const last = msgs[msgs.length - 1];

		// Pop truly empty trailing assistant message (no content blocks at all — no tokens arrived before abort).
		// Prevents DeepSeek 400 — it requires content or tool_calls on every assistant turn.
		// Thinking-only messages are kept — the reasoning context is valuable even if interrupted.
		if (last.role === 'assistant' && last.content.length === 0) {
			msgs.pop();
			agent.restoreHistory(msgs);
			return;
		}

		// Assistant with real content was interrupted — inject hidden user marker
		// so the model knows it was cut off (prevents mid-sentence continuation).
		if (last.role === 'assistant' && last.content.some((c) => c.type === 'text')) {
			const interruptMsg: Message = {
				role: 'user',
				content: '[Response interrupted by user]',
				timestamp: Date.now(),
				metadata: { hidden: true },
			};
			msgs.push(interruptMsg);
			agent.restoreHistory(msgs);
			this.sessionStore.addMessage(sessionId, interruptMsg);
		}
	}

	private generateId(): string {
		return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
	}
}
