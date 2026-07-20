import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../tui/types.js';

vi.mock('@opentui/core', () => ({
	RGBA: class RGBA {
		static fromHex(value: string) { return value; }
	},
	SyntaxStyle: class SyntaxStyle {
		static fromStyles(value: unknown) { return value; }
	},
}));

describe('session message hydration', () => {
	it('hydrates persisted file attachments with display badges', async () => {
		const { sdkMessagesToChatMessages } = await import('../tui/utils/session-messages.js');
		const converted = sdkMessagesToChatMessages({
			model: 'test-model',
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: 'Review this file' },
						{
							type: 'file',
							mime: 'text/typescript',
							filename: 'example.ts',
							url: 'file:///tmp/example.ts',
							metadata: { sizeBytes: 42 },
						},
					],
					timestamp: Date.now(),
				},
			],
		});

		expect(converted.messages[0].attachments).toHaveLength(1);
		expect(converted.messages[0].attachments?.[0].badge.color).toBeTruthy();
		expect(converted.messages[0].attachments?.[0].filename).toBe('example.ts');
	});

	it('hydrates delivered steering messages as normal user messages', async () => {
		const { sdkMessagesToChatMessages } = await import('../tui/utils/session-messages.js');
		const converted = sdkMessagesToChatMessages({
			model: 'test-model',
			messages: [
				{
					role: 'user',
					content: 'Queued text',
					metadata: { steeringStatus: 'sent' },
					timestamp: Date.now(),
				},
			],
		});

		expect(converted.messages[0]).toMatchObject({
			role: 'user',
			content: 'Queued text',
			model: 'test-model',
		});
		expect(converted.messages[0]).not.toHaveProperty('steeringStatus');
	});

	it('hydrates subagent tool result arguments from assistant tool calls', async () => {
		const { sdkMessagesToChatMessages } = await import('../tui/utils/session-messages.js');
		const converted = sdkMessagesToChatMessages({
			model: 'test-model',
			messages: [
				{
					role: 'assistant',
					content: [
						{
							type: 'toolCall',
							id: 'call-read',
							name: 'read',
							arguments: { path: 'crates/spectra-rs/src/circuit_breaker.rs' },
						},
					],
					stopReason: 'toolUse',
					timestamp: Date.now(),
				},
				{
					role: 'toolResult',
					toolCallId: 'call-read',
					toolName: 'read',
					content: [{ type: 'text', text: 'file contents' }],
					isError: false,
					timestamp: Date.now(),
				},
			],
		});

		expect(converted.messages[1]).toMatchObject({
			role: 'tool',
			meta: 'read({"path":"crates/spectra-rs/src/circuit_breaker.rs"})',
			content: 'file contents',
		});
	});

	it('uses persisted agent metadata instead of the session default for historical turns', async () => {
		const { sdkMessagesToChatMessages } = await import('../tui/utils/session-messages.js');
		const converted = sdkMessagesToChatMessages({
			model: 'test-model',
			agent: 'build',
			messages: [
				{
					role: 'assistant',
					content: [{ type: 'text', text: 'debug result' }],
					stopReason: 'stop',
					metadata: { agent: 'debug' },
					timestamp: Date.now(),
				},
				{
					role: 'toolResult',
					toolCallId: 'call',
					toolName: 'read',
					content: [{ type: 'text', text: 'output' }],
					isError: false,
					metadata: { agent: 'debug' },
					timestamp: Date.now(),
				},
			],
		});

		expect(converted.messages[0]?.agent).toBe('debug');
		expect(converted.messages[1]?.agent).toBe('debug');
	});

	it('renders persisted provider failures instead of a blank assistant turn', async () => {
		const { sdkMessagesToChatMessages } = await import('../tui/utils/session-messages.js');
		const converted = sdkMessagesToChatMessages({
			model: 'test-model',
			messages: [{
				role: 'assistant',
				content: [],
				provider: 'openai',
				model: 'test-model',
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				stopReason: 'error',
				errorMessage: 'Request timed out',
				metadata: { error: { kind: 'timeout', retryable: true, responseBody: 'retained for diagnostics' } },
				timestamp: Date.now(),
			}],
		});

		expect(converted.messages[0]).toMatchObject({
			role: 'assistant',
			content: '[error] Request timed out',
			turnStatus: 'error',
		});
	});

	it('sums every completed turn for session token totals', async () => {
		const { sumTurnTokens } = await import('../tui/utils/session-messages.js');
		const messages = [
			{ id: 'user', role: 'user', content: 'First turn' },
			{ id: 'first', role: 'assistant', content: 'One', turnTokens: { input: 100, output: 25 } },
			{ id: 'second', role: 'assistant', content: 'Two', turnTokens: { input: 180, output: 40 } },
			{ id: 'tool', role: 'tool', content: 'Result' },
		] satisfies ChatMessage[];

		expect(sumTurnTokens(messages)).toEqual({ input: 280, output: 65 });
	});
});
