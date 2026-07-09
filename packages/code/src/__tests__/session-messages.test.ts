import { describe, expect, it, vi } from 'vitest';

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
});
