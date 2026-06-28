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
});
