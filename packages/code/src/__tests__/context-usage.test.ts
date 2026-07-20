import { describe, expect, it } from 'vitest';
import type { AssistantMessage, Context, Message, ToolResultMessage, UserMessage } from '@mohanscodex/spectra-ai';
import {
	compactMessages,
	findCompactionCutPoint,
	promptTokensFromUsage,
	resolveCompactionBudget,
} from '../services/compaction.js';
import {
	completeContextSnapshot,
	createContextBreakdown,
	createPreparedContextSnapshot,
} from '../services/context-usage.js';

function user(content: string, timestamp: number): UserMessage {
	return { role: 'user', content, timestamp };
}

function assistant(options: {
	provider?: string;
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	content?: AssistantMessage['content'];
	timestamp: number;
}): AssistantMessage {
	const input = options.input ?? 0;
	const output = options.output ?? 0;
	return {
		role: 'assistant',
		content: options.content ?? [{ type: 'text', text: 'done' }],
		provider: options.provider ?? 'openai',
		model: 'test-model',
		usage: {
			input,
			output,
			cacheRead: options.cacheRead ?? 0,
			cacheWrite: options.cacheWrite ?? 0,
			totalTokens: input + output,
		},
		stopReason: 'stop',
		timestamp: options.timestamp,
	};
}

describe('compaction budgets and cut points', () => {
	it('uses the model window and leaves unknown windows uncompacted', () => {
		expect(resolveCompactionBudget(undefined)).toBeUndefined();
		const budget = resolveCompactionBudget(100_000);
		expect(budget).toMatchObject({
			contextWindow: 100_000,
			reserveTokens: 16_384,
			thresholdTokens: 83_616,
		});
	});

	it('keeps tool calls with their results when the recent budget cuts through them', () => {
		const toolResult: ToolResultMessage = {
			role: 'toolResult',
			toolCallId: 'call-1',
			toolName: 'read',
			content: [{ type: 'text', text: 'x'.repeat(2_000) }],
			isError: false,
			timestamp: 3,
		};
		const messages: Message[] = [
			user('old context '.repeat(2_000), 1),
			assistant({
				timestamp: 2,
				content: [{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'src/a.ts' } }],
			}),
			toolResult,
			user('continue', 4),
		];

		expect(findCompactionCutPoint(messages, 100)).toBe(1);
		const compacted = compactMessages(messages, 'Preserve the old work.', { keepRecentTokens: 100 });
		expect(compacted[1]).toBe(messages[1]);
		expect(compacted[2]).toBe(toolResult);
	});
});

describe('provider-anchored context accounting', () => {
	it('normalizes cache usage without double-counting OpenAI cached tokens', () => {
		const usage = { input: 1_000, output: 100, cacheRead: 800, cacheWrite: 50, totalTokens: 1_100 };
		expect(promptTokensFromUsage('anthropic', usage)).toBe(1_850);
		expect(promptTokensFromUsage('openai-completions', usage)).toBe(1_000);
		expect(promptTokensFromUsage('custom-compatible', usage)).toBe(1_000);
	});

	it('falls back to prepared local estimates when the provider omits usage', () => {
		const context: Context = {
			systemPrompt: 'base\n\nenvironment',
			messages: [user('hello', 1)],
			tools: [{ name: 'read', description: 'Read a file', parameters: { type: 'object' } }],
		};
		const prepared = createPreparedContextSnapshot({
			context,
			attribution: {
				baseSystemPrompt: 'base',
				systemContext: ['environment'],
				skillsHint: '',
				fingerprint: 'context-v1',
			},
			modelId: 'test-model',
			providerId: 'openai-completions',
			contextWindow: 10_000,
		});
		const completed = completeContextSnapshot(prepared, assistant({ timestamp: 2 }));

		expect(completed.anchored).toBe(false);
		expect(completed.promptTokens).toBe(0);
		expect(completed.messagesTokens).toBeGreaterThan(prepared.preparedMessagesTokens);
	});

	it('allocates exactly 200 cells while retaining tiny categories', () => {
		const prepared = createPreparedContextSnapshot({
			context: {
				systemPrompt: 'base\n\ncontext',
				messages: [user('message '.repeat(8_000), 1)],
				tools: [{ name: 'tool', description: 'x', parameters: { type: 'object' } }],
			},
			attribution: {
				baseSystemPrompt: 'base',
				systemContext: ['context'],
				skillsHint: '',
				fingerprint: 'large-context',
			},
			modelId: 'test-model',
			providerId: 'openai-completions',
			contextWindow: 1_000,
		});
		const snapshot = completeContextSnapshot(prepared, assistant({ input: 2_000, output: 10, timestamp: 2 }));
		const breakdown = createContextBreakdown(snapshot);

		expect(breakdown.cells).toHaveLength(200);
		expect(breakdown.cells.some((cell) => cell.color === 'accent')).toBe(true);
		expect(breakdown.cells.some((cell) => cell.color === 'warning')).toBe(true);
		expect(breakdown.cells.some((cell) => cell.color === 'messages')).toBe(true);
	});
});
