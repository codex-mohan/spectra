import type { Message } from '@mohanscodex/spectra-ai';

const DEFAULT_CONTEXT_WINDOW = 200_000;
const COMPACTION_THRESHOLD = 0.8;
const MIN_MESSAGES_TO_COMPACT = 6;
const TAIL_MESSAGES_TO_KEEP = 4;

const SUMMARY_PROMPT = `Summarize this conversation concisely. Preserve:
- The user's goal and requirements
- Key decisions made
- Files created or modified (with paths)
- Current progress and blockers
- Any important technical details

Conversation to summarize:
`;

export interface CompactionOptions {
	contextWindow?: number;
	threshold?: number;
	minMessages?: number;
	tailMessages?: number;
}

export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(msg: Message): number {
	let text = '';
	if (typeof msg.content === 'string') {
		text = msg.content;
	} else if (Array.isArray(msg.content)) {
		for (const block of msg.content) {
			if (block.type === 'text') text += (block as any).text;
			else if (block.type === 'toolCall') text += JSON.stringify((block as any).arguments || {});
		}
	}
	return estimateTokens(text) + 4;
}

export function estimateTotalTokens(messages: Message[]): number {
	return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

export function needsCompaction(messages: Message[], options: CompactionOptions = {}): boolean {
	const contextWindow = options.contextWindow || DEFAULT_CONTEXT_WINDOW;
	const threshold = options.threshold || COMPACTION_THRESHOLD;
	const minMessages = options.minMessages || MIN_MESSAGES_TO_COMPACT;

	if (messages.length < minMessages) return false;

	const totalTokens = estimateTotalTokens(messages);
	return totalTokens > contextWindow * threshold;
}

export function buildCompactionPrompt(messages: Message[]): string {
	const lines: string[] = [];
	for (const msg of messages) {
		const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
		let text = '';
		if (typeof msg.content === 'string') {
			text = msg.content;
		} else if (Array.isArray(msg.content)) {
			const textBlocks = msg.content.filter((b) => b.type === 'text');
			text = textBlocks.map((b: any) => b.text).join('\n');
		}
		if (text.trim()) {
			lines.push(`${role}: ${text.slice(0, 2000)}`);
		}
	}
	return SUMMARY_PROMPT + lines.join('\n\n');
}

export function compactMessages(
	messages: Message[],
	summary: string,
	options: CompactionOptions = {},
): Message[] {
	const tailCount = options.tailMessages || TAIL_MESSAGES_TO_KEEP;
	const tail = messages.slice(-tailCount);
	const summaryMessage: Message = {
		role: 'user',
		content: `[Context Compaction]\n\n${summary}`,
		timestamp: Date.now(),
	};
	return [summaryMessage, ...tail];
}

export function createTransformContextFn(
	getModel: () => { model: string; provider: string } | null,
	getApiKey: (provider: string) => string | undefined,
	options: CompactionOptions = {},
) {
	return async (messages: Message[], signal?: AbortSignal): Promise<Message[]> => {
		if (!needsCompaction(messages, options)) return messages;

		const modelInfo = getModel();
		if (!modelInfo) return messages;

		const apiKey = getApiKey(modelInfo.provider);
		if (!apiKey) return messages;

		try {
			const { stream } = await import('@mohanscodex/spectra-ai');
			const { initProviders } = await import('@mohanscodex/spectra-ai');
			initProviders();

			const modelObj = { id: modelInfo.model, name: modelInfo.model, provider: modelInfo.provider, api: modelInfo.provider };
			const prompt = buildCompactionPrompt(messages);
			const ctx = { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] };
			const events = stream(modelObj as any, ctx, { apiKey });

			let summary = '';
			for await (const event of events) {
				if (signal?.aborted) return messages;
				if (event.type === 'text_delta' && event.delta) {
					summary += event.delta;
				}
			}

			summary = summary.trim();
			if (!summary || summary.length < 50) return messages;

			return compactMessages(messages, summary, options);
		} catch {
			return messages;
		}
	};
}
