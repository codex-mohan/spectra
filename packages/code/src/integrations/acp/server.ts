import { createInterface } from 'readline';
import { Agent, type AgentEvent } from '@mohanscodex/spectra-agent';
import { initProviders } from '@mohanscodex/spectra-ai';
import type { Message, AssistantMessage, AssistantMessageEvent } from '@mohanscodex/spectra-ai';
import { loadContext } from '../../services/context.js';
import { loadConfig } from '../../services/config.js';
import { AgentRegistry } from '../../agents/registry.js';
import { AGENT_DEFINITIONS, filterToolsByAgent } from '../../agents/index.js';
import { createAllToolsWithExtensions } from '../../tools/index.js';
import { connectAllServers, shutdownAllServers } from '../mcp/index.js';
import { readAll } from '../../services/auth-store.js';

const PKG_VERSION = '0.4.0';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: number | string;
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number | string;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

interface AcpSession {
	id: string;
	agent: Agent;
}

function send(id: number | string, result: unknown): void {
	const msg: JsonRpcResponse = { jsonrpc: '2.0', id, result };
	process.stdout.write(JSON.stringify(msg) + '\n');
}

function error(id: number | string, code: number, message: string): void {
	const msg: JsonRpcResponse = { jsonrpc: '2.0', id, error: { code, message } };
	process.stdout.write(JSON.stringify(msg) + '\n');
}

function notify(method: string, params: unknown): void {
	const msg = { jsonrpc: '2.0', method, params };
	process.stdout.write(JSON.stringify(msg) + '\n');
}

export class ACPAdapter {
	private sessions = new Map<string, AcpSession>();

	start(): void {
		process.stderr.write('ACP server starting...\n');

		const rl = createInterface({ input: process.stdin });
		rl.on('line', (line) => {
			const trimmed = line.trim();
			if (!trimmed) return;
			try {
				const req: JsonRpcRequest = JSON.parse(trimmed);
				this.handle(req).catch((err) => {
					if (req.id !== undefined) error(req.id, -32603, err instanceof Error ? err.message : String(err));
				});
			} catch {
				/* malformed JSON — ignore */
			}
		});

		rl.on('close', () => {
			for (const s of this.sessions.values()) s.agent.abort();
			this.sessions.clear();
			process.exit(0);
		});
	}

	private async handle(req: JsonRpcRequest): Promise<void> {
		switch (req.method) {
			case 'initialize':
				return this.onInitialize(req);
			case 'session/new':
				return this.onSessionNew(req);
			case 'session/prompt':
				return this.onSessionPrompt(req);
			case 'session/cancel':
				return this.onSessionCancel(req);
			case 'shutdown':
				process.exit(0);
			default:
				if (req.id !== undefined) error(req.id, -32601, `Method not found: ${req.method}`);
		}
	}

	private onInitialize(req: JsonRpcRequest): void {
		send(req.id!, {
			protocolVersion: '0.1.0',
			serverInfo: { name: 'Spectra Code', version: PKG_VERSION },
			capabilities: {},
		});
	}

	private async onSessionNew(req: JsonRpcRequest): Promise<void> {
		const params = req.params as { sessionId?: string } | undefined;
		const sessionId = params?.sessionId ?? crypto.randomUUID();

		try {
			await initProviders();

			const config = loadConfig();
			const agentName = config.agent || 'build';
			const def = AGENT_DEFINITIONS[agentName];
			if (!def) {
				error(req.id!, -32603, `Unknown agent: ${agentName}`);
				return;
			}

			const providerModel = config.model || 'anthropic/claude-sonnet-4-20250514';
			const provider = providerModel.includes('/') ? providerModel.split('/')[0] : 'anthropic';
			const modelId = providerModel.includes('/') ? providerModel.split('/').slice(1).join('/') : providerModel;

			if (config.mcp?.length) {
				await connectAllServers(config.mcp).catch(() => {});
			}

			const toolResult = await createAllToolsWithExtensions();
			const agentTools = def ? filterToolsByAgent(toolResult.all, agentName) : toolResult.all;
			const context = loadContext();

			const { loadMemorySnapshot } = await import('../../services/memory.js');
			const memorySnapshot = loadMemorySnapshot();

			const systemPrompt = [context.systemPrompt, memorySnapshot, def.prompt].filter(Boolean).join('\n\n');

			const agent = new Agent({
				model: { id: modelId, name: modelId, provider, api: provider },
				systemPrompt,
				getApiKey: (p: string) => {
					const cred = readAll()[p];
					return cred?.type === 'api' ? cred.key : undefined;
				},
				tools: agentTools,
				maxTurns: def.maxTurns ?? 10,
			});

			AgentRegistry.setConfig({
				model: { id: modelId, name: modelId, provider, api: provider },
				getApiKey: (p: string) => {
					const cred = readAll()[p];
					return cred?.type === 'api' ? cred.key : undefined;
				},
			});

			this.sessions.set(sessionId, { id: sessionId, agent });
			send(req.id!, { sessionId, serverInfo: { name: 'Spectra Code', version: PKG_VERSION } });
		} catch (err) {
			error(req.id!, -32603, err instanceof Error ? err.message : String(err));
		}
	}

	private async onSessionPrompt(req: JsonRpcRequest): Promise<void> {
		const params = req.params as { sessionId: string; message: { role: string; content: string } };
		const session = this.sessions.get(params.sessionId);
		if (!session) {
			error(req.id!, -32602, `Session not found: ${params.sessionId}`);
			return;
		}

		const text =
			typeof params.message?.content === 'string'
				? params.message.content
				: JSON.stringify(params.message?.content ?? '');

		send(req.id!, { status: 'accepted' });

		try {
			notify('session/update', { sessionId: params.sessionId, status: 'running' });

			for await (const event of session.agent.run({
				role: 'user',
				content: text,
				timestamp: Date.now(),
			})) {
				this.emitEvent(params.sessionId, event);
				if (event.type === 'agent_end') break;
			}
		} catch (err) {
			if (!session.agent.isStreaming) {
				notify('session/update', {
					sessionId: params.sessionId,
					status: 'error',
					error: err instanceof Error ? err.message : String(err),
				});
			}
		}
	}

	private emitEvent(sessionId: string, event: AgentEvent): void {
		switch (event.type) {
			case 'turn_start':
				notify('session/update', { sessionId, status: 'thinking' });
				break;

			case 'message_update': {
				const ae = event.assistantMessageEvent;
				switch (ae.type) {
					case 'text_delta':
						notify('session/update', { sessionId, content: { type: 'text', text: ae.delta } });
						break;
					case 'thinking_delta':
						notify('session/update', { sessionId, content: { type: 'thought', text: ae.delta } });
						break;
					case 'toolcall_delta':
						notify('session/update', { sessionId, content: { type: 'toolcall', text: ae.delta } });
						break;
				}
				break;
			}

			case 'tool_execution_start':
				notify('session/update', {
					sessionId,
					status: 'running',
					toolCall: { id: event.toolCallId, name: event.toolName, args: event.args, status: 'running' },
				});
				break;

			case 'tool_execution_end':
				notify('session/update', {
					sessionId,
					status: 'running',
					toolCall: {
						id: event.toolCallId,
						name: event.toolName,
						result: event.result,
						status: event.isError ? 'error' : 'completed',
					},
				});
				break;

			case 'agent_end': {
				const lastAssistant = [...event.messages].reverse().find((m: Message) => m.role === 'assistant') as
					| AssistantMessage
					| undefined;
				notify('session/update', {
					sessionId,
					status: 'done',
					message: lastAssistant
						? {
								role: 'assistant',
								content: lastAssistant.content,
								stopReason: lastAssistant.stopReason,
							}
						: undefined,
				});
				break;
			}
		}
	}

	private onSessionCancel(req: JsonRpcRequest): void {
		const params = req.params as { sessionId: string };
		const session = this.sessions.get(params.sessionId);
		if (session) {
			session.agent.abort();
			this.sessions.delete(params.sessionId);
		}
		if (req.id !== undefined) send(req.id!, { status: 'cancelled' });
	}
}
