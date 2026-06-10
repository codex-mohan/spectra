import type { ToolResult } from '@mohanscodex/spectra-agent';

export function textResult(text: string): ToolResult {
	return { content: [{ type: 'text', text } as { type: 'text'; text: string }] };
}

export function errorResult(message: string): ToolResult {
	return {
		content: [{ type: 'text', text: message } as { type: 'text'; text: string }],
		isError: true,
	};
}
