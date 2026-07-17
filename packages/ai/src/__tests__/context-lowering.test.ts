import { describe, it, expect } from 'vitest';
import type { Context, ContextMessage, Model } from '../types.js';
import { lowerAnthropicContextMessages } from '../providers/anthropic.js';
import { convertMessages, lowerOpenAICompletionsContextMessages } from '../providers/openai-completions.js';
import { convertResponsesMessages, lowerOpenAIResponsesContextMessages } from '../providers/openai-responses.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ctx = (content: string): ContextMessage => ({ role: 'developer', content });

const userMsg = (text: string) => ({ role: 'user' as const, content: text });
const userMsgArray = (...texts: string[]) => ({
	role: 'user' as const,
	content: texts.map((t) => ({ type: 'text' as const, text: t })),
});
const assistantMsg = (text: string) => ({
	role: 'assistant' as const,
	content: [{ type: 'text' as const, text }],
});

const model = (provider: string): Model => ({ id: 'test-model', name: 'Test', provider, api: provider });
const requestContext = (): Context => ({
	systemPrompt: 'stable system',
	contextMessages: [ctx('current mode')],
	messages: [
		{ role: 'user', content: 'prior turn', timestamp: 1 },
		{ role: 'user', content: 'current turn', timestamp: 2 },
	],
});

// ── Anthropic lowering ───────────────────────────────────────────────────────

describe('lowerAnthropicContextMessages', () => {
	it('returns messages unchanged when contextMessages is empty', () => {
		const messages = [userMsg('hello')];
		const result = lowerAnthropicContextMessages([], messages);
		expect(result).toBe(messages); // same reference — no copy
	});

	it('does not mutate the input messages array', () => {
		const original = [userMsg('hello')];
		const frozen = JSON.stringify(original);
		lowerAnthropicContextMessages([ctx('instruction')], original);
		expect(JSON.stringify(original)).toBe(frozen);
	});

	it('does not mutate the input contextMessages array', () => {
		const messages: readonly ContextMessage[] = [ctx('instruction')];
		lowerAnthropicContextMessages(messages, [userMsg('hi')]);
		expect(messages).toHaveLength(1);
	});

	it('prepends tagged text BEFORE user content (string)', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('Be concise.')],
			[userMsg('hello')],
		);
		const content = result[0].content as string;
		// Tag must come BEFORE the original text
		expect(content.indexOf('<context>')).toBeLessThan(content.indexOf('hello'));
		expect(content).toContain('<context>\nBe concise.\n</context>');
		expect(content).toContain('hello');
	});

	it('prepends tagged text BEFORE user content (array)', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('Be concise.')],
			[userMsgArray('original')],
		);
		const content = result[0].content as Array<{ type: string; text: string }>;
		// First block should be the context tag, second should be original
		expect(content[0].type).toBe('text');
		expect(content[0].text).toContain('<context>');
		expect(content[0].text).toContain('Be concise.');
		expect(content[1].type).toBe('text');
		expect(content[1].text).toBe('original');
	});

	it('prepends to the LAST user message, not earlier ones', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('instruction')],
			[userMsg('first'), userMsg('second')],
		);
		expect(result).toHaveLength(2);
		// First user message untouched
		expect(result[0].content).toBe('first');
		// Second user message has context prepended
		const content = result[1].content as string;
		expect(content.indexOf('<context>')).toBeLessThan(content.indexOf('second'));
	});

	it('creates a synthetic user message when no user message exists', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('Be concise.')],
			[assistantMsg('thinking')],
		);
		expect(result).toHaveLength(2);
		expect(result[1].role).toBe('user');
		const content = result[1].content as string;
		expect(content).toContain('<context>');
		expect(content).toContain('Be concise.');
	});

	it('wraps multiple context messages in separate <context> tags', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('First instruction'), ctx('Second instruction')],
			[userMsg('hello')],
		);
		const content = result[0].content as string;
		expect(content).toContain('<context>\nFirst instruction\n</context>');
		expect(content).toContain('<context>\nSecond instruction\n</context>');
	});

	it('sanitizes surrogates in context content', () => {
		const result = lowerAnthropicContextMessages(
			[ctx('before \uD800 after')],
			[userMsg('hi')],
		);
		const content = result[0].content as string;
		expect(content).not.toContain('\uD800');
	});
});

// ── OpenAI Completions lowering ──────────────────────────────────────────────

describe('lowerOpenAICompletionsContextMessages', () => {
	it('returns empty array when contextMessages is empty', () => {
		expect(lowerOpenAICompletionsContextMessages([], 'openai')).toHaveLength(0);
	});

	it('does not mutate the input contextMessages array', () => {
		const messages: readonly ContextMessage[] = [ctx('instruction')];
		lowerOpenAICompletionsContextMessages(messages, 'openai');
		expect(messages).toHaveLength(1);
	});

	it('inserts OpenAI developer context immediately before the latest user on the wire', () => {
		const canonical = requestContext();
		const before = JSON.stringify(canonical);
		const result = convertMessages(model('openai'), canonical);

		expect(result.map((message) => message.role)).toEqual(['system', 'user', 'developer', 'user']);
		expect(result[2]).toEqual({ role: 'developer', content: 'current mode' });
		expect(JSON.stringify(canonical)).toBe(before);
	});

	it('inserts the tagged fallback immediately before the latest user on compatible APIs', () => {
		const result = convertMessages(model('groq'), requestContext());
		expect(result.map((message) => message.role)).toEqual(['system', 'user', 'user', 'user']);
		expect(String(result[2]?.content)).toContain('<context>\ncurrent mode\n</context>');
	});

	describe('openai / openai-codex providers', () => {
		it('returns developer-role items', () => {
			const result = lowerOpenAICompletionsContextMessages(
				[ctx('Be concise.')],
				'openai',
			);
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ role: 'developer', content: 'Be concise.' });
		});

		it('preserves order of multiple context messages', () => {
			const result = lowerOpenAICompletionsContextMessages(
				[ctx('First'), ctx('Second')],
				'openai-codex',
			);
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ role: 'developer', content: 'First' });
			expect(result[1]).toEqual({ role: 'developer', content: 'Second' });
		});

		it('sanitizes surrogates in developer message content', () => {
			const result = lowerOpenAICompletionsContextMessages(
				[ctx('before \uD800 after')],
				'openai',
			);
			expect(result[0].content).toBe('before  after');
		});
	});

	describe('other providers (tagged user fallback)', () => {
		it('returns a tagged user-role item', () => {
			const result = lowerOpenAICompletionsContextMessages(
				[ctx('Be concise.')],
				'anthropic',
			);
			expect(result).toHaveLength(1);
			expect(result[0].role).toBe('user');
			const content = result[0].content as string;
			expect(content).toContain('<context>');
			expect(content).toContain('Be concise.');
			expect(content).toContain('</context>');
		});

		it('sanitizes surrogates in tagged content', () => {
			const result = lowerOpenAICompletionsContextMessages(
				[ctx('before \uD800 after')],
				'groq',
			);
			const content = result[0].content as string;
			expect(content).not.toContain('\uD800');
		});
	});
});

// ── OpenAI Responses lowering ────────────────────────────────────────────────

describe('lowerOpenAIResponsesContextMessages', () => {
	it('returns empty array when contextMessages is empty', () => {
		expect(lowerOpenAIResponsesContextMessages([])).toEqual([]);
	});

	it('does not mutate the input contextMessages array', () => {
		const messages: readonly ContextMessage[] = [ctx('instruction')];
		lowerOpenAIResponsesContextMessages(messages);
		expect(messages).toHaveLength(1);
	});

	it('inserts developer context immediately before the latest Responses user input', () => {
		const canonical = requestContext();
		const before = JSON.stringify(canonical);
		const result = convertResponsesMessages(model('openai'), canonical) as Array<Record<string, unknown>>;

		expect(result.map((message) => message.role)).toEqual(['system', 'user', 'developer', 'user']);
		expect(result[2]).toEqual({ role: 'developer', content: 'current mode' });
		expect(JSON.stringify(canonical)).toBe(before);
	});

	it('returns developer-role input items', () => {
		const result = lowerOpenAIResponsesContextMessages([ctx('Be concise.')]);
		expect(result).toEqual([{ role: 'developer', content: 'Be concise.' }]);
	});

	it('preserves order of multiple context messages', () => {
		const result = lowerOpenAIResponsesContextMessages([ctx('First'), ctx('Second')]);
		expect(result).toEqual([
			{ role: 'developer', content: 'First' },
			{ role: 'developer', content: 'Second' },
		]);
	});

	it('sanitizes surrogates in content', () => {
		const result = lowerOpenAIResponsesContextMessages([ctx('before \uD800 after')]);
		expect(result[0]).toEqual({ role: 'developer', content: 'before  after' });
	});
});
