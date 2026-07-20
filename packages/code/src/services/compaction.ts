import { initProviders, stream } from '@mohanscodex/spectra-ai';
import type { AssistantMessage, Message, Model, ToolResultMessage, Usage } from '@mohanscodex/spectra-ai';

const DEFAULT_RESERVE_TOKENS = 16_384;
const DEFAULT_KEEP_RECENT_TOKENS = 20_000;
const IMAGE_TOKEN_ESTIMATE = 1_200;
const MESSAGE_FRAMING_TOKENS = 4;

const SUMMARY_PROMPT = `Summarize the conversation prefix for continued work. Preserve:
- The user's current goal and explicit requirements
- Decisions, constraints, and unresolved questions
- Files read, created, or modified, including relevant paths
- Tool results and errors that affect the remaining work
- Current progress and concrete next steps

Do not invent facts. Do not continue the task. Return only the summary.

Conversation prefix:
`;

export interface CompactionOptions {
	contextWindow?: number;
	threshold?: number;
	thresholdTokens?: number;
	reserveTokens?: number;
	keepRecentTokens?: number;
	nonMessageTokens?: number;
}

export interface CompactionBudget {
	contextWindow: number;
	thresholdTokens: number;
	reserveTokens: number;
	keepRecentTokens: number;
	summaryMaxTokens: number;
}

export interface CompactionModelInfo {
	model: string;
	provider: string;
	contextWindow?: number;
	nonMessageTokens?: number;
}
export interface CompactionCallbacks {
	onCompacted?: (messages: readonly Message[]) => void | Promise<void>;
}

interface MessageEstimateOptions {
	excludeOpaqueReasoning?: boolean;
}


export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(new TextEncoder().encode(text).byteLength / 4);
}

function stringify(value: unknown): string {
	try {
		return JSON.stringify(value) ?? '';
	} catch {
		return String(value);
	}
}

function estimateFileBlock(block: Extract<ToolResultMessage['content'][number], { type: 'file' }>): number {
	const sourceText = block.source?.text?.value;
	if (sourceText) return estimateTokens(block.filename) + estimateTokens(sourceText);
	const sizeBytes = block.metadata?.sizeBytes;
	if (typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) && sizeBytes > 0) {
		return estimateTokens(block.filename) + Math.ceil(sizeBytes / 4);
	}
	return estimateTokens(block.filename) + estimateTokens(block.url);
}

export function estimateMessageTokens(message: Message, options: MessageEstimateOptions = {}): number {
	let tokens = MESSAGE_FRAMING_TOKENS;
	if (message.role === 'user') {
		if (typeof message.content === 'string') return tokens + estimateTokens(message.content);
		for (const block of message.content) {
			if (block.type === 'text') tokens += estimateTokens(block.text);
			else if (block.type === 'image') tokens += IMAGE_TOKEN_ESTIMATE;
			else tokens += estimateFileBlock(block);
		}
		return tokens;
	}

	if (message.role === 'assistant') {
		for (const block of message.content) {
			if (block.type === 'text') tokens += estimateTokens(block.text);
			else if (block.type === 'thinking') {
				tokens += estimateTokens(block.thinking);
				if (block.thinkingSignature && !options.excludeOpaqueReasoning) tokens += estimateTokens(block.thinkingSignature);
			} else {
				tokens += estimateTokens(block.name) + estimateTokens(stringify(block.arguments));
				if (block.thinkingSignature && !options.excludeOpaqueReasoning) tokens += estimateTokens(block.thinkingSignature);
			}
		}
		return tokens;
	}

	tokens += estimateTokens(message.toolName);
	for (const block of message.content) {
		if (block.type === 'text') tokens += estimateTokens(block.text);
		else if (block.type === 'image') tokens += IMAGE_TOKEN_ESTIMATE;
		else tokens += estimateFileBlock(block);
	}
	return tokens;
}

export function estimateTotalTokens(messages: readonly Message[], options: MessageEstimateOptions = {}): number {
	let total = 0;
	for (const message of messages) total += estimateMessageTokens(message, options);
	return total;
}

function validUsageNumber(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Provider prompt usage without changing SDK semantics. Anthropic reports cache
 * reads/writes outside input; OpenAI includes cached tokens in input. Unknown
 * providers use the largest native prompt-shaped total without adding caches.
 */
export function promptTokensFromUsage(provider: string, usage: Usage): number {
	const input = validUsageNumber(usage.input);
	const cacheRead = validUsageNumber(usage.cacheRead);
	const cacheWrite = validUsageNumber(usage.cacheWrite);
	const derivedPrompt = Math.max(0, validUsageNumber(usage.totalTokens) - validUsageNumber(usage.output));
	const normalizedProvider = provider.toLowerCase();
	if (normalizedProvider.includes('anthropic')) return input + cacheRead + cacheWrite;
	if (normalizedProvider.includes('openai') || normalizedProvider.includes('copilot')) {
		return input || derivedPrompt;
	}
	return Math.max(input, derivedPrompt);
}

export function latestProviderPromptTokens(messages: readonly Message[]): number {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== 'assistant' || message.stopReason === 'error' || message.stopReason === 'aborted') continue;
		const promptTokens = promptTokensFromUsage(message.provider, message.usage);
		if (promptTokens > 0) return promptTokens;
	}
	return 0;
}

export function resolveCompactionBudget(
	contextWindow: number | undefined,
	options: CompactionOptions = {},
): CompactionBudget | undefined {
	if (!contextWindow || !Number.isFinite(contextWindow) || contextWindow <= 1) return undefined;
	const window = Math.floor(contextWindow);
	const reserveFloor = options.reserveTokens && options.reserveTokens > 0
		? Math.floor(options.reserveTokens)
		: DEFAULT_RESERVE_TOKENS;
	const reserveTokens = Math.min(window - 1, Math.max(Math.floor(window * 0.15), reserveFloor));

	let thresholdTokens: number;
	if (options.thresholdTokens && Number.isFinite(options.thresholdTokens) && options.thresholdTokens > 0) {
		thresholdTokens = Math.floor(options.thresholdTokens);
	} else if (options.threshold && Number.isFinite(options.threshold) && options.threshold > 0) {
		thresholdTokens = Math.floor(window * Math.min(0.99, options.threshold));
	} else {
		thresholdTokens = window - reserveTokens;
	}
	thresholdTokens = Math.min(window - 1, Math.max(1, thresholdTokens));

	const requestedRecent = options.keepRecentTokens && options.keepRecentTokens > 0
		? Math.floor(options.keepRecentTokens)
		: DEFAULT_KEEP_RECENT_TOKENS;
	const keepRecentTokens = Math.max(1, Math.min(requestedRecent, Math.max(1, thresholdTokens - 1)));
	return {
		contextWindow: window,
		thresholdTokens,
		reserveTokens,
		keepRecentTokens,
		summaryMaxTokens: Math.max(256, Math.floor(reserveTokens * 0.8)),
	};
}

export function contextTokensForCompaction(
	messages: readonly Message[],
	nonMessageTokens = 0,
): number {
	const providerAnchor = latestProviderPromptTokens(messages);
	const storedEstimate = estimateTotalTokens(messages, { excludeOpaqueReasoning: true }) + Math.max(0, nonMessageTokens);
	return Math.max(providerAnchor, storedEstimate);
}

export function needsCompaction(messages: readonly Message[], options: CompactionOptions = {}): boolean {
	const budget = resolveCompactionBudget(options.contextWindow, options);
	if (!budget || messages.length < 2) return false;
	return contextTokensForCompaction(messages, options.nonMessageTokens) > budget.thresholdTokens;
}

function toolCallIds(message: Message): Set<string> {
	const ids = new Set<string>();
	if (message.role !== 'assistant') return ids;
	for (const block of message.content) {
		if (block.type === 'toolCall') ids.add(block.id);
	}
	return ids;
}

function safeTailStart(messages: readonly Message[], candidate: number): number {
	let start = Math.max(1, Math.min(candidate, messages.length - 1));
	if (messages[start]?.role !== 'toolResult') return start;

	const resultIds = new Set<string>();
	for (let index = start; index < messages.length; index++) {
		const result = messages[index];
		if (result.role !== 'toolResult') break;
		resultIds.add(result.toolCallId);
	}
	for (let index = start - 1; index >= 0; index--) {
		const calls = toolCallIds(messages[index]);
		for (const id of resultIds) {
			if (calls.has(id)) return Math.max(1, index);
		}
	}

	while (start < messages.length && messages[start].role === 'toolResult') start++;
	return Math.min(start, messages.length - 1);
}

export function findCompactionCutPoint(messages: readonly Message[], keepRecentTokens: number): number {
	if (messages.length < 2) return 0;
	let accumulated = 0;
	let candidate = messages.length - 1;
	for (let index = messages.length - 1; index > 0; index--) {
		accumulated += estimateMessageTokens(messages[index]);
		candidate = index;
		if (accumulated >= keepRecentTokens) break;
	}
	return safeTailStart(messages, candidate);
}

function serializeMessage(message: Message): string {
	if (message.role === 'user') {
		const content = typeof message.content === 'string'
			? message.content
			: message.content.map((block) => {
				if (block.type === 'text') return block.text;
				if (block.type === 'image') return '[image]';
				return `[file: ${block.filename}]${block.source?.text?.value ? `\n${block.source.text.value}` : ''}`;
			}).join('\n');
		return `User:\n${content}`;
	}
	if (message.role === 'assistant') {
		const content = message.content.map((block) => {
			if (block.type === 'text') return block.text;
			if (block.type === 'thinking') return `[thinking]\n${block.thinking}`;
			return `[tool call: ${block.name}]\n${stringify(block.arguments)}`;
		}).join('\n');
		return `Assistant:\n${content}`;
	}
	const content = message.content.map((block) => {
		if (block.type === 'text') return block.text;
		if (block.type === 'image') return '[image]';
		return `[file: ${block.filename}]`;
	}).join('\n');
	return `Tool result (${message.toolName}${message.isError ? ', error' : ''}):\n${content}`;
}

export function buildCompactionPrompt(messages: readonly Message[]): string {
	return SUMMARY_PROMPT + messages.map(serializeMessage).join('\n\n');
}

export function compactMessages(
	messages: readonly Message[],
	summary: string,
	options: CompactionOptions = {},
): Message[] {
	const cleanSummary = summary.trim();
	if (!cleanSummary || messages.length < 2) return [...messages];
	const cutPoint = findCompactionCutPoint(messages, options.keepRecentTokens ?? DEFAULT_KEEP_RECENT_TOKENS);
	if (cutPoint <= 0 || cutPoint >= messages.length) return [...messages];
	const compacted: Message[] = [
		{
			role: 'user',
			content: `[Context Compaction]\n\n${cleanSummary}`,
			timestamp: Date.now(),
			metadata: { compactedMessageCount: cutPoint },
		},
		...messages.slice(cutPoint),
	];
	return estimateTotalTokens(compacted) < estimateTotalTokens(messages) ? compacted : [...messages];
}

export function createTransformContextFn(
	getModel: () => CompactionModelInfo | null,
	getApiKey: (provider: string) => string | undefined,
	options: CompactionOptions = {},
	callbacks: CompactionCallbacks = {},
) {
	let cached: { sourceLength: number; sourceLastMessage: Message; messages: Message[] } | undefined;
	return async (messages: Message[], signal?: AbortSignal): Promise<Message[]> => {
		let activeMessages = messages;
		if (cached) {
			const sourceStillMatches = messages.length >= cached.sourceLength
				&& messages[cached.sourceLength - 1] === cached.sourceLastMessage;
			if (sourceStillMatches) activeMessages = [...cached.messages, ...messages.slice(cached.sourceLength)];
			else cached = undefined;
		}

		const modelInfo = getModel();
		if (!modelInfo) return activeMessages;
		const contextWindow = modelInfo.contextWindow ?? options.contextWindow;
		const budget = resolveCompactionBudget(contextWindow, options);
		if (!budget) return activeMessages;
		const nonMessageTokens = modelInfo.nonMessageTokens ?? options.nonMessageTokens ?? 0;
		if (contextTokensForCompaction(activeMessages, nonMessageTokens) <= budget.thresholdTokens) return activeMessages;

		const cutPoint = findCompactionCutPoint(activeMessages, budget.keepRecentTokens);
		if (cutPoint <= 0 || cutPoint >= activeMessages.length) return activeMessages;
		const apiKey = getApiKey(modelInfo.provider);
		if (!apiKey || signal?.aborted) return activeMessages;

		try {
			initProviders();
			const model: Model = {
				id: modelInfo.model,
				name: modelInfo.model,
				provider: modelInfo.provider,
				api: modelInfo.provider,
			};
			const events = stream(
				model,
				{ messages: [{ role: 'user', content: buildCompactionPrompt(activeMessages.slice(0, cutPoint)), timestamp: Date.now() }] },
				{ apiKey, maxTokens: budget.summaryMaxTokens },
			);
			let summary = '';
			for await (const event of events) {
				if (signal?.aborted) return activeMessages;
				if (event.type === 'text_delta' && event.delta) summary += event.delta;
			}
			if (!summary.trim()) return activeMessages;
			const compacted = compactMessages(activeMessages, summary, {
				...options,
				keepRecentTokens: budget.keepRecentTokens,
			});
			if (estimateTotalTokens(compacted) >= estimateTotalTokens(activeMessages)) return activeMessages;
			cached = {
				sourceLength: messages.length,
				sourceLastMessage: messages[messages.length - 1],
				messages: compacted,
			};
			try {
				await callbacks.onCompacted?.(compacted);
			} catch {
				// Persistence failure must not discard a valid in-memory compaction.
			}
			return compacted;
		} catch {
			return activeMessages;
		}
	};
}
