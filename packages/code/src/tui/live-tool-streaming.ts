import { parse as parsePartialJson } from 'partial-json';

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseToolArguments(rawJson: string, fallback: Record<string, unknown>): Record<string, unknown> {
	if (!rawJson) return fallback;
	try {
		const parsed = parsePartialJson(rawJson);
		return isRecord(parsed) ? parsed : fallback;
	} catch {
		return fallback;
	}
}

export function toolResultText(content: unknown): string {
	if (!Array.isArray(content)) return '';
	return content
		.filter((block): block is { type: 'text'; text: string } => {
			if (!isRecord(block)) return false;
			return block.type === 'text' && typeof block.text === 'string';
		})
		.map((block) => block.text)
		.join('\n');
}
