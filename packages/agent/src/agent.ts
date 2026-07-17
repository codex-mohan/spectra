import type {
	Model,
	StreamOptions,
	Context,
	Message,
	AssistantMessage,
	ToolCall,
	ToolResultMessage,
	ProviderErrorDetails,
} from '@mohanscodex/spectra-ai';
import { normalizeProviderError, stream, EventStream } from '@mohanscodex/spectra-ai';
import type {
	AgentTool,
	ToolResult,
	ToolUpdateCallback,
	ToolExecutionMode,
	BeforeToolCallContext,
	AfterToolCallContext,
	AgentEvent,
	AgentEventListener,
	AgentConfig,
	AgentRuntimeConfig,
	BeforeModelCallContext,
	RetryContext,
	RetryDecision,
	AgentQueueMode,
	ContextMessage,
} from './types.js';

type EmitFn = (event: AgentEvent) => void | Promise<void>;

function providerFailureFrom(message: AssistantMessage): ProviderErrorDetails | undefined {
	const error = message.metadata?.error;
	if (!error || typeof error !== 'object') return undefined;
	const details = error as Partial<ProviderErrorDetails>;
	return typeof details.message === 'string' && typeof details.kind === 'string' && typeof details.retryable === 'boolean'
		? details as ProviderErrorDetails
		: undefined;
}
type ResolvedProvenanceConfig = {
	enabled: boolean;
	audit: boolean;
	messageProvenance: boolean;
	includeArgs: 'none' | 'hash' | 'redacted' | 'full';
	includeContextDiff: boolean;
};

const DEFAULT_PROVENANCE_CONFIG: ResolvedProvenanceConfig = {
	enabled: true,
	audit: true,
	messageProvenance: true,
	includeArgs: 'hash',
	includeContextDiff: false,
};

function resolveProvenanceConfig(config: AgentConfig['provenance']): ResolvedProvenanceConfig {
	if (config === false) {
		return { ...DEFAULT_PROVENANCE_CONFIG, enabled: false, audit: false, messageProvenance: false };
	}
	if (config === true || config === undefined) return { ...DEFAULT_PROVENANCE_CONFIG };
	return {
		...DEFAULT_PROVENANCE_CONFIG,
		...config,
		audit: config.enabled === false ? false : (config.audit ?? DEFAULT_PROVENANCE_CONFIG.audit),
		messageProvenance:
			config.enabled === false ? false : (config.messageProvenance ?? DEFAULT_PROVENANCE_CONFIG.messageProvenance),
	};
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
	const record = value as Record<string, unknown>;
	return `{${Object.keys(record)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
		.join(',')}}`;
}

function hashValue(value: unknown): string {
	const text = stableStringify(value);
	let hash = 2166136261;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}


class PendingMessageQueue {
	private messages: Message[] = [];
	constructor(public mode: AgentQueueMode) {}

	enqueue(message: Message): void {
		this.messages.push(message);
	}

	hasItems(): boolean {
		return this.messages.length > 0;
	}

	drain(): Message[] {
		if (this.mode === 'all') {
			const drained = this.messages.slice();
			this.messages = [];
			return drained;
		}
		const first = this.messages[0];
		if (!first) return [];
		this.messages = this.messages.slice(1);
		return [first];
	}

	clear(): void {
		this.messages = [];
	}
}

interface PreparedToolCall {
	toolCall: ToolCall;
	tool: AgentTool | null;
	args: Record<string, unknown>;
	blocked: boolean;
	blockReason?: string;
	blockedBy?: string;
	argsTransformed?: boolean;
}

class AgentEventStream extends EventStream<AgentEvent, Message[]> {
	constructor() {
		super(
			(event) => event.type === 'agent_end',
			(event) => {
				if (event.type === 'agent_end') {
					return event.messages;
				}
				return [];
			},
		);
	}
}

export class Agent {
	private tools = new Map<string, AgentTool>();
	private listeners: AgentEventListener[] = [];
	private abortController: AbortController | null = null;
	private _isStreaming = false;
	private _streamingMessage?: AssistantMessage;
	private _pendingToolCalls = new Set<string>();
	private _errorMessage?: string;
	private _messages: Message[] = [];

	private model: Model;
	private systemPrompt?: string;
	private maxTurns?: number;
	private toolExecution: ToolExecutionMode;
	private beforeToolCallHook?: AgentConfig['beforeToolCall'];
	private afterToolCallHook?: AgentConfig['afterToolCall'];
	private transformContextFn?: AgentConfig['transformContext'];
	private beforeModelCallHook?: AgentConfig['beforeModelCall'];
	private getApiKeyFn?: AgentConfig['getApiKey'];
	private _contextMessages?: readonly ContextMessage[];
	private streamOptions?: StreamOptions;
	private steeringQueue: PendingMessageQueue;
	private followUpQueue: PendingMessageQueue;
	private convertToLlmFn?: (messages: Message[]) => Message[] | Promise<Message[]>;
	private maxRetryDelayMs: number;
	private retryCount = 0;
	private provenanceConfig: ResolvedProvenanceConfig;
	private onRetryHook?: (context: RetryContext) => RetryDecision | void;

	constructor(config: AgentConfig) {
		this.model = config.model;
		this.systemPrompt = config.systemPrompt;
		this.maxTurns = config.maxTurns;
		this.toolExecution = config.toolExecution ?? 'parallel';
		this.beforeToolCallHook = config.beforeToolCall;
		this.afterToolCallHook = config.afterToolCall;
		this.transformContextFn = config.transformContext;
		this.beforeModelCallHook = config.beforeModelCall;
		this.getApiKeyFn = config.getApiKey;
		this.streamOptions = config.streamOptions;
		this.steeringQueue = new PendingMessageQueue(config.steeringMode ?? 'one-at-a-time');
		this.followUpQueue = new PendingMessageQueue(config.followUpMode ?? 'one-at-a-time');
		this.convertToLlmFn = config.convertToLlm;
		this.maxRetryDelayMs = config.maxRetryDelayMs ?? 30000;
		this.provenanceConfig = resolveProvenanceConfig(config.provenance);
		this.onRetryHook = config.onRetry;
		this.replaceRuntimeConfig(config);
	}

	get messages(): Message[] {
		return [...this._messages];
	}

	restoreHistory(messages: Message[]): void {
		this._messages = [...messages];
	}
	get isStreaming(): boolean {
		return this._isStreaming;
	}
	get streamingMessage(): AssistantMessage | undefined {
		return this._streamingMessage;
	}
	get pendingToolCalls(): ReadonlySet<string> {
		return this._pendingToolCalls;
	}
	get errorMessage(): string | undefined {
		return this._errorMessage;
	}
	get signal(): AbortSignal | undefined {
		return this.abortController?.signal;
	}

	registerTool(tool: AgentTool): void {
		this.tools.set(tool.name, tool);
	}

	configure(config: AgentRuntimeConfig): void {
		if (this._isStreaming) {
			throw new Error('Cannot configure an agent while it is processing a prompt');
		}
		this.replaceRuntimeConfig(config);
	}

	subscribe(listener: AgentEventListener): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	steer(message: string | Message): void {
		const msg =
			typeof message === 'string' ? { role: 'user' as const, content: message, timestamp: Date.now() } : message;
		this.steeringQueue.enqueue(msg);
	}

	followUp(message: string | Message): void {
		const msg =
			typeof message === 'string' ? { role: 'user' as const, content: message, timestamp: Date.now() } : message;
		this.followUpQueue.enqueue(msg);
	}

	abort(): void {
		this.abortController?.abort();
	}

	reset(): void {
		this._messages = [];
		this._isStreaming = false;
		this._streamingMessage = undefined;
		this._pendingToolCalls = new Set();
		this._errorMessage = undefined;
		this.steeringQueue.clear();
		this.followUpQueue.clear();
	}

	async *run(
		input: string | Message | Message[],
		options?: { signal?: AbortSignal },
	): AsyncGenerator<AgentEvent> {
		const agentStream = new AgentEventStream();
		const emit: EmitFn = async (event) => {
			agentStream.push(event);
			for (const listener of this.listeners) {
				try {
					await listener(event, this.abortController?.signal);
				} catch {
					// Isolate listener errors so one failing subscriber doesn't break others
				}
			}
			if (event.type === 'agent_end') {
				agentStream.end(event.messages);
			}
		};

		const userMessages = this.normalizeInput(input);
		if (this._isStreaming) throw new Error('Agent is already processing a prompt');

		this.abortController = new AbortController();

		// Link external signal — aborting it aborts this agent
		if (options?.signal) {
			if (options.signal.aborted) {
				this.abortController.abort();
			} else {
				options.signal.addEventListener('abort', () => this.abortController?.abort(), { once: true });
			}
		}
		this._isStreaming = true;
		this._errorMessage = undefined;

		for (const msg of userMessages) {
			this._messages.push(msg);
		}

		// Emit initial events synchronously before starting the loop
		await emit({ type: 'agent_start' });
		for (const msg of userMessages) {
			await emit({ type: 'message_start', message: msg });
			await emit({ type: 'message_end', message: msg });
		}
		await emit({ type: 'turn_start' });

		// Start runLoop fire-and-forget so we can yield events progressively
		const runPromise = this.runLoop(emit)
			.catch(async (err) => {
				this._errorMessage = err instanceof Error ? err.message : String(err);
				// Safety net: always emit agent_end so the generator doesn't hang
				await emit({ type: 'agent_end', messages: this._messages });
			})
			.finally(() => {
				this._isStreaming = false;
				this._streamingMessage = undefined;
				this._pendingToolCalls = new Set();
				this.abortController = null;
			});

		// Yield events to consumer as they arrive during streaming
		for await (const event of agentStream) {
			yield event;
		}

		// Ensure runLoop has fully completed
		await runPromise;
	}

	private async runLoop(emit: EmitFn): Promise<void> {
		let turns = 0;

		while (!this.abortController?.signal.aborted) {
			// Check maxTurns limit only if configured
			if (this.maxTurns !== undefined && turns >= this.maxTurns) {
				this._errorMessage = `Reached turn limit (${this.maxTurns}). Continue the conversation to keep going.`;
				break;
			}
			if (turns > 0) {
				await emit({ type: 'turn_start' });
			}
			turns++;
			let ctxMessages = [...this._messages];

			if (this.transformContextFn) {
				const beforeHash = hashValue(ctxMessages);
				const beforeMessageCount = ctxMessages.length;
				try {
					ctxMessages = await this.transformContextFn(ctxMessages, this.abortController!.signal);
					const afterHash = hashValue(ctxMessages);
					await this.emitAudit(
						'context_transformed',
						{
							hook: 'transformContext',
							beforeMessageCount,
							afterMessageCount: ctxMessages.length,
							beforeHash,
							afterHash,
							changed: beforeHash !== afterHash,
						},
						emit,
					);
				} catch (err) {
					await this.emitAudit(
						'hook_error',
						{
							hook: 'transformContext',
							errorMessage: err instanceof Error ? err.message : String(err),
							fallbackBehavior: 'aborted',
						},
						emit,
					);
					throw err;
				}
			}

			let context = this.buildContext(ctxMessages);
			if (this.beforeModelCallHook) {
				const beforeHash = hashValue(context);
				try {
					const result = await this.beforeModelCallHook(
						this.createBeforeModelCallContext(context, turns),
						this.abortController!.signal,
					);
					if (result?.messages !== undefined) context.messages = [...result.messages];
					if (result?.contextMessages !== undefined) {
						context.contextMessages = result.contextMessages.map((message) => ({ ...message }));
					}
					const afterHash = hashValue(context);
					await this.emitAudit(
						'context_prepared',
						{ hook: 'beforeModelCall', iteration: turns, beforeHash, afterHash, changed: beforeHash !== afterHash },
						emit,
					);
				} catch (err) {
					await this.emitAudit(
						'hook_error',
						{
							hook: 'beforeModelCall',
							errorMessage: err instanceof Error ? err.message : String(err),
							fallbackBehavior: 'aborted',
						},
						emit,
					);
					throw err;
				}
			}

			const resolvedApiKey = this.getApiKeyFn
				? await this.getApiKeyFn(this.model.provider)
				: this.streamOptions?.apiKey;
			const opts = { ...this.streamOptions, apiKey: resolvedApiKey, signal: this.abortController?.signal };

			let assistantMessage: AssistantMessage;
			try {
				assistantMessage = await this.streamAssistantResponse(context, opts, emit);
			} catch (err) {
				this._errorMessage = err instanceof Error ? err.message : String(err);
				const errorMsg = this.createErrorMessage(err);
				this._messages.push(errorMsg);
				await emit({ type: 'message_start', message: errorMsg });
				await emit({ type: 'message_end', message: errorMsg });
				await emit({ type: 'agent_end', messages: this._messages });
				return;
			}

			if (assistantMessage.stopReason === 'error' || assistantMessage.stopReason === 'aborted') {
				this._errorMessage = assistantMessage.errorMessage ?? providerFailureFrom(assistantMessage)?.message ?? 'Model request failed';
				await emit({ type: 'agent_end', messages: this._messages });
				return;
			}
			const toolCalls = assistantMessage.content.filter((c): c is ToolCall => c.type === 'toolCall');

			if (toolCalls.length === 0) {
				await emit({ type: 'turn_end', message: assistantMessage, toolResults: [] });
				const drained = await this.drainEndOfTurnQueues(emit);
				if (drained) {
					turns = 0;
					continue;
				}
				await emit({ type: 'agent_end', messages: this._messages });
				return;
			}

			const toolResults =
				this.toolExecution === 'sequential'
					? await this.executeToolCallsSequential(toolCalls, assistantMessage, emit)
					: await this.executeToolCallsParallel(toolCalls, assistantMessage, emit);

			await emit({ type: 'turn_end', message: assistantMessage, toolResults });

			const drained = await this.drainSteeringQueue(emit);
			if (drained) {
				turns = 0;
				continue;
			}
		}

		await emit({ type: 'agent_end', messages: this._messages });
	}

	private async drainQueuedMessages(queue: PendingMessageQueue, emit: EmitFn): Promise<boolean> {
		const queuedMessages = queue.drain();
		if (queuedMessages.length === 0) return false;
		for (const msg of queuedMessages) {
			this._messages.push(msg);
			await emit({ type: 'message_start', message: msg });
			await emit({ type: 'message_end', message: msg });
		}
		return true;
	}

	private async drainQueueAfterYield(queue: PendingMessageQueue, emit: EmitFn): Promise<boolean> {
		// Drain messages already submitted.
		if (await this.drainQueuedMessages(queue, emit)) return true;

		// Yield to let pending steer()/followUp() calls triggered during this turn
		// enqueue before we commit to ending the turn.
		await Promise.resolve();

		// Final drain check for messages that arrived during the yield.
		return this.drainQueuedMessages(queue, emit);
	}

	private async drainSteeringQueue(emit: EmitFn): Promise<boolean> {
		return this.drainQueueAfterYield(this.steeringQueue, emit);
	}

	private async drainEndOfTurnQueues(emit: EmitFn): Promise<boolean> {
		if (await this.drainSteeringQueue(emit)) return true;
		return this.drainQueueAfterYield(this.followUpQueue, emit);
	}

	private async streamAssistantResponse(
		context: Context,
		opts: StreamOptions,
		emit: EmitFn,
	): Promise<AssistantMessage> {
		// Apply convertToLlm hook if provided
		if (this.convertToLlmFn) {
			context.messages = await this.convertToLlmFn(context.messages);
		}

		return this.streamWithRetry(context, opts, emit);
	}

	private async streamWithRetry(context: Context, opts: StreamOptions, emit: EmitFn): Promise<AssistantMessage> {
		const maxRetries = 3;
		let lastError: Error | undefined;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				return await this.doStream(context, opts, emit);
			} catch (err) {
				lastError = err instanceof Error ? err : new Error(String(err));

				if (this._streamingMessage && this._messages[this._messages.length - 1] === this._streamingMessage) {
					this._messages.pop();
					this._streamingMessage = undefined;
				}

				if (this.abortController?.signal.aborted) {
					await this.emitAudit(
						'retry_cancelled',
						{ attempt: attempt + 1, errorMessage: lastError.message, reason: 'aborted' },
						emit,
					);
					throw lastError;
				}
				if (!this.isRetryableError(err)) throw lastError;

				if (attempt < maxRetries) {
					let delay = Math.min(1000 * Math.pow(2, attempt), this.maxRetryDelayMs) + Math.random() * 1000;
					let decidedBy: 'default' | 'onRetry' = 'default';

					if (this.onRetryHook) {
						try {
							const decision = this.onRetryHook({ error: lastError, attempt: attempt + 1, delay });
							if (decision?.shouldRetry === false) {
								await this.emitAudit(
									'retry_cancelled',
									{
										attempt: attempt + 1,
										errorMessage: lastError.message,
										decidedBy: 'onRetry',
										reason: 'hook_returned_false',
									},
									emit,
								);
								throw lastError;
							}
							if (decision?.delay !== undefined) delay = decision.delay;
							decidedBy = 'onRetry';
						} catch (hookErr) {
							if (hookErr === lastError) throw hookErr;
							await this.emitAudit(
								'hook_error',
								{
									hook: 'onRetry',
									errorMessage: hookErr instanceof Error ? hookErr.message : String(hookErr),
									fallbackBehavior: 'default_retry',
								},
								emit,
							);
						}
					}

					await this.emitAudit(
						'retry_scheduled',
						{
							attempt: attempt + 1,
							maxRetries,
							errorMessage: lastError.message,
							delayMs: delay,
							decidedBy,
							willRetry: true,
						},
						emit,
					);
					await this.sleep(delay);
				} else {
					await this.emitAudit(
						'retry_exhausted',
						{ attempts: maxRetries + 1, errorMessage: lastError.message },
						emit,
					);
				}
			}
		}

		throw lastError;
	}

	private isRetryableError(err: unknown): boolean {
		const status = (err as any)?.status ?? (err as any)?.statusCode;
		if (status && status >= 400 && status < 500 && status !== 429) return false;
		if (status && (status >= 500 || status === 429)) return true;
		const msg = err instanceof Error ? err.message : String(err);
		return /overloaded|rate.?limit|network.?error|connection.?(error|refused|reset)|socket hang up|fetch failed|timed? ?out|timeout|ECONNRESET|ENOTFOUND|EPIPE/i.test(msg);
	}

	private sleep(ms: number): Promise<void> {
		const signal = this.abortController?.signal;
		if (signal?.aborted) return Promise.reject(new Error('Aborted'));
		return new Promise((resolve, reject) => {
			const onAbort = () => {
				clearTimeout(timer);
				reject(new Error('Aborted'));
			};
			const timer = setTimeout(() => {
				signal?.removeEventListener('abort', onAbort);
				resolve();
			}, ms);
			signal?.addEventListener('abort', onAbort, { once: true });
		});
	}

	private shouldAttachMessageProvenance(): boolean {
		return this.provenanceConfig.enabled && this.provenanceConfig.messageProvenance;
	}

	private async emitAudit(eventType: string, details: Record<string, unknown>, emit: EmitFn): Promise<void> {
		if (!this.provenanceConfig.enabled || !this.provenanceConfig.audit) return;
		await emit({ type: 'audit', eventType, details, timestamp: Date.now() });
	}

	private async doStream(context: Context, opts: StreamOptions, emit: EmitFn): Promise<AssistantMessage> {
		let partialMessage: AssistantMessage | null = null;
		let addedPartial = false;

		const eventStream = stream(this.model, context, opts);

		for await (const event of eventStream) {
			if (this.abortController?.signal.aborted) break;

			switch (event.type) {
				case 'start':
					partialMessage = event.partial;
					this._streamingMessage = partialMessage;
					this._messages.push(partialMessage);
					addedPartial = true;
					await emit({ type: 'message_start', message: { ...partialMessage } });
					break;

				case 'text_start':
				case 'text_delta':
				case 'text_end':
				case 'thinking_start':
				case 'thinking_delta':
				case 'thinking_end':
				case 'toolcall_start':
				case 'toolcall_delta':
				case 'toolcall_end':
					if (partialMessage) {
						partialMessage = event.partial;
						this._messages[this._messages.length - 1] = partialMessage;
						this._streamingMessage = partialMessage;
						await emit({ type: 'message_update', message: { ...partialMessage }, assistantMessageEvent: event });
					}
					break;

				case 'done':
				case 'error':
					const finalMessage = await eventStream.result();
					if (addedPartial) {
						this._messages[this._messages.length - 1] = finalMessage;
					} else {
						this._messages.push(finalMessage);
					}
					if (!addedPartial) {
						await emit({ type: 'message_start', message: { ...finalMessage } });
					}
					await emit({ type: 'message_end', message: finalMessage });
					this._streamingMessage = undefined;
					return finalMessage;
			}
		}

		const finalMessage = await eventStream.result();
		if (addedPartial) {
			this._messages[this._messages.length - 1] = finalMessage;
		} else {
			this._messages.push(finalMessage);
			await emit({ type: 'message_start', message: { ...finalMessage } });
		}
		await emit({ type: 'message_end', message: finalMessage });
		this._streamingMessage = undefined;
		return finalMessage;
	}

	private async executeToolCallsSequential(
		toolCalls: ToolCall[],
		assistantMessage: AssistantMessage,
		emit: EmitFn,
	): Promise<ToolResultMessage[]> {
		const results: ToolResultMessage[] = [];
		for (const tc of toolCalls) {
			if (this.abortController?.signal.aborted) break;
			const result = await this.executeSingleToolCall(tc, assistantMessage, emit);
			results.push(result);
		}
		return results;
	}

	private async executeToolCallsParallel(
		toolCalls: ToolCall[],
		assistantMessage: AssistantMessage,
		emit: EmitFn,
	): Promise<ToolResultMessage[]> {
		// Phase 1: Prepare all tool calls sequentially (validation + hooks)
		const prepared = await this.prepareToolCalls(toolCalls, assistantMessage, emit);

		// Phase 2: Execute all prepared tool calls in parallel
		const executed = await Promise.all(prepared.map((p) => this.executePreparedToolCall(p, assistantMessage, emit)));

		return executed;
	}

	private async prepareToolCalls(
		toolCalls: ToolCall[],
		assistantMessage: AssistantMessage,
		emit: EmitFn,
	): Promise<PreparedToolCall[]> {
		const prepared: PreparedToolCall[] = [];

		for (const toolCall of toolCalls) {
			if (this.abortController?.signal.aborted) break;

			await emit({
				type: 'tool_execution_start',
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				args: toolCall.arguments,
			});
			this._pendingToolCalls.add(toolCall.id);

			const tool = this.tools.get(toolCall.name);
			if (!tool) {
				prepared.push({
					toolCall,
					tool: null,
					args: toolCall.arguments,
					blocked: true,
					blockReason: `Unknown tool "${toolCall.name}"`,
					blockedBy: 'toolRegistry',
				});
				continue;
			}

			let args = toolCall.arguments;
			if (tool.prepareArguments) {
				try {
					args = tool.prepareArguments(args);
				} catch (err) {
					prepared.push({
						toolCall,
						tool: null,
						args,
						blocked: true,
						blockReason: `Argument validation failed: ${err instanceof Error ? err.message : String(err)}`,
						blockedBy: 'prepareArguments',
					});
					continue;
				}
			}

			let argsTransformed = false;
			if (this.beforeToolCallHook) {
				try {
					const result = await this.beforeToolCallHook(
						{ assistantMessage, toolCall, args, context: this.buildContext() },
						this.abortController?.signal,
					);
					if (result?.block) {
						prepared.push({
							toolCall,
							tool: null,
							args,
							blocked: true,
							blockReason: result.reason ?? 'Tool call blocked',
							blockedBy: 'beforeToolCall',
						});
						continue;
					}
					if (result?.transform) {
						const originalArgsHash = hashValue(args);
						args = result.transform.modifiedArgs;
						argsTransformed = true;
						await this.emitAudit(
							'tool_arguments_transformed',
							{
								toolCallId: toolCall.id,
								toolName: toolCall.name,
								transformedBy: 'beforeToolCall',
								originalArgsHash,
								transformedArgsHash: hashValue(args),
							},
							emit,
						);
					}
				} catch (err) {
					await this.emitAudit(
						'hook_error',
						{
							hook: 'beforeToolCall',
							toolCallId: toolCall.id,
							toolName: toolCall.name,
							errorMessage: err instanceof Error ? err.message : String(err),
							fallbackBehavior: 'blocked',
						},
						emit,
					);
					prepared.push({
						toolCall,
						tool: null,
						args,
						blocked: true,
						blockReason: `beforeToolCall hook error: ${err instanceof Error ? err.message : String(err)}`,
						blockedBy: 'beforeToolCall',
					});
					continue;
				}
			}

			prepared.push({ toolCall, tool, args, blocked: false, argsTransformed });
		}

		return prepared;
	}

	private async executePreparedToolCall(
		prepared: PreparedToolCall,
		assistantMessage: AssistantMessage,
		emit: EmitFn,
	): Promise<ToolResultMessage> {
		const { toolCall, tool, args, blocked, blockReason, blockedBy, argsTransformed } = prepared;

		if (blocked) {
			this._pendingToolCalls.delete(toolCall.id);
			const reason = blockReason ?? 'Tool call blocked';
			await this.emitAudit(
				'tool_blocked',
				{ toolCallId: toolCall.id, toolName: toolCall.name, blockedBy: blockedBy ?? 'unknown', blockReason: reason },
				emit,
			);
			return this.finalizeToolCall(
				toolCall,
				{ content: [{ type: 'text', text: reason }], isError: true },
				true,
				assistantMessage,
				emit,
				this.shouldAttachMessageProvenance() ? { blockedBy: blockedBy ?? 'unknown', blockReason: reason } : undefined,
			);
		}

		let toolResult: ToolResult;
		try {
			const onUpdate: ToolUpdateCallback = (partial) => {
				emit({
					type: 'tool_execution_update',
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					args,
					partialResult: partial,
				});
			};
			toolResult = await tool!.execute(toolCall.id, args, this.abortController?.signal, onUpdate);
		} catch (err) {
			toolResult = {
				content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
				isError: true,
			};
		}

		this._pendingToolCalls.delete(toolCall.id);
		const provenance = this.shouldAttachMessageProvenance() && argsTransformed
			? { transformedBy: 'beforeToolCall', hookDetails: { argumentsTransformed: true } }
			: undefined;
		return this.finalizeToolCall(toolCall, toolResult, toolResult.isError ?? false, assistantMessage, emit, provenance);
	}

	private async executeSingleToolCall(
		toolCall: ToolCall,
		assistantMessage: AssistantMessage,
		emit: EmitFn,
	): Promise<ToolResultMessage> {
		// Sequential path: prepare then execute immediately
		const [prepared] = await this.prepareToolCalls([toolCall], assistantMessage, emit);
		return this.executePreparedToolCall(prepared, assistantMessage, emit);
	}

	private async finalizeToolCall(
		toolCall: ToolCall,
		result: ToolResult,
		isError: boolean,
		assistantMessage: AssistantMessage,
		emit: EmitFn,
		provenance?: ToolResultMessage['provenance'],
	): Promise<ToolResultMessage> {
		let wasOverridden = false;
		const originalResultHash = hashValue({ content: result.content, isError });
		const originalIsError = isError;
		if (this.afterToolCallHook) {
			try {
				const override = await this.afterToolCallHook(
					{ assistantMessage, toolCall, args: toolCall.arguments, result, isError, context: this.buildContext() },
					this.abortController?.signal,
				);
				if (override) {
					if (override.content) {
						result = { ...result, content: override.content };
						wasOverridden = true;
					}
					if (override.isError !== undefined) isError = override.isError;
				}
			} catch (err) {
				await this.emitAudit(
					'hook_error',
					{
						hook: 'afterToolCall',
						toolCallId: toolCall.id,
						toolName: toolCall.name,
						errorMessage: err instanceof Error ? err.message : String(err),
						fallbackBehavior: 'used_original_result',
					},
					emit,
				);
			}
		}

		if (wasOverridden) {
			await this.emitAudit(
				'tool_result_replaced',
				{
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					transformedBy: 'afterToolCall',
					originalResultHash,
					replacementResultHash: hashValue({ content: result.content, isError }),
					isErrorChanged: originalIsError !== isError,
				},
				emit,
			);
			if (this.shouldAttachMessageProvenance()) {
				provenance = {
					...provenance,
					transformedBy: 'afterToolCall',
					hookDetails: { ...provenance?.hookDetails, replaced: true },
				};
			}
		}

		const msg: ToolResultMessage = {
			role: 'toolResult',
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			content: result.content,
			details: result.details,
			isError,
			timestamp: Date.now(),
			provenance,
		};
		this._messages.push(msg);

		// Emit message events so consumers can track tool results in the transcript
		await emit({ type: 'message_start', message: msg });
		await emit({ type: 'message_end', message: msg });

		await emit({ type: 'tool_execution_end', toolCallId: toolCall.id, toolName: toolCall.name, result, isError });

		return msg;
	}

	private replaceRuntimeConfig(config: AgentRuntimeConfig): void {
		const tools = new Map<string, AgentTool>();
		for (const tool of config.tools ?? []) {
			tools.set(tool.name, tool);
		}
		this.model = config.model;
		this.systemPrompt = config.systemPrompt;
		this.maxTurns = config.maxTurns;
		this.toolExecution = config.toolExecution ?? 'parallel';
		this.streamOptions = config.streamOptions;
		this.tools = tools;
		this._contextMessages = config.contextMessages?.map((m) => ({ ...m }));
	}

	private createBeforeModelCallContext(context: Context, iteration: number): BeforeModelCallContext {
		return {
			model: this.model,
			systemPrompt: context.systemPrompt,
			messages: [...context.messages],
			tools: [...(context.tools ?? [])],
			iteration,
			contextMessages: this._contextMessages?.map((m) => ({ ...m })),
		};
	}

	private buildContext(messages?: Message[]): Context {
		const toolDefs = Array.from(this.tools.values()).map((t) => ({
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		}));
		return {
			systemPrompt: this.systemPrompt,
			messages: messages ?? this._messages,
			tools: toolDefs.length > 0 ? toolDefs : undefined,
			contextMessages: this._contextMessages?.map((m) => ({ ...m })),
		};
	}

	private createErrorMessage(err: unknown): AssistantMessage {
		const details = normalizeProviderError(err, { aborted: this.abortController?.signal.aborted === true });
		return {
			role: 'assistant',
			content: [],
			provider: this.model.provider,
			model: this.model.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			stopReason: details.kind === 'aborted' ? 'aborted' : 'error',
			errorMessage: details.message,
			timestamp: Date.now(),
			metadata: { error: details },
		};
	}

	private normalizeInput(input: string | Message | Message[]): Message[] {
		if (Array.isArray(input)) {
			return input.map((m) =>
				typeof m === 'string' ? { role: 'user' as const, content: m, timestamp: Date.now() } : m,
			);
		}
		if (typeof input === 'string') {
			return [{ role: 'user', content: input, timestamp: Date.now() }];
		}
		return [input];
	}
}
