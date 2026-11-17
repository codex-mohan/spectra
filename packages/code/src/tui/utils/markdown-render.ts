import { renderMermaidASCII } from 'beautiful-mermaid';
import { renderMathInText } from './math.js';
import { hasComplexScript } from './display-text.js';

const MAX_DIAGRAM_SOURCE = 20_000;

function normalizeProse(source: string): string {
	const code: string[] = [];
	const protectedText = source
		.replace(/```[\s\S]*?```/g, (block) => `\u0002${code.push(block) - 1}\u0002`)
		.replace(/`[^`\n]*`/g, (span) => `\u0002${code.push(span) - 1}\u0002`);
	return protectedText.normalize('NFC').replace(/\u0002(\d+)\u0002/g, (_, index: string) => code[Number(index)] ?? '');
}

function renderMermaidBlocks(source: string, skip: boolean): string {
	if (skip) return source;
	return source.replace(/```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/g, (block, language: string, body: string) => {
		if (language.toLowerCase() !== 'mermaid') return block;
		if (body.length > MAX_DIAGRAM_SOURCE) return block;
		try {
			const ascii = renderMermaidASCII(body, { useAscii: false, colorMode: 'none' }).trimEnd();
			if (!ascii) return block;
			return `\`\`\`\n${ascii}\n\`\`\``;
		} catch {
			return block;
		}
	});
}

export interface MarkdownSegment {
	kind: 'markdown' | 'pre';
	text: string;
}

/**
 * Split fenced code blocks that contain complex scripts out of markdown.
 * OpenTUI's code/table text buffers mis-measure combining marks and wide
 * scripts; rendering those blocks as plain preformatted text avoids the
 * stale-cell trail they leave when the transcript scrolls.
 */
export function splitComplexCodeFences(source: string): MarkdownSegment[] {
	const segments: MarkdownSegment[] = [];
	const fence = /```([A-Za-z0-9_-]*)\r?\n([\s\S]*?)```/g;
	let cursor = 0;
	for (const match of source.matchAll(fence)) {
		const index = match.index ?? 0;
		const language = (match[1] ?? '').toLowerCase();
		const body = match[2] ?? '';
		if (language === 'mermaid' || !hasComplexScript(body)) continue;
		if (index > cursor) segments.push({ kind: 'markdown', text: source.slice(cursor, index) });
		segments.push({ kind: 'pre', text: body.trimEnd() });
		cursor = index + match[0].length;
	}
	if (cursor === 0) return [{ kind: 'markdown', text: source }];
	if (cursor < source.length) segments.push({ kind: 'markdown', text: source.slice(cursor) });
	return segments;
}

/**
 * Prepare model-authored markdown: normalize display text, close an open fence
 * for streaming, render complete Mermaid fences, then convert LaTeX spans.
 */
export function prepareMarkdown(source: string, options: { streaming?: boolean } = {}): string {
	let text = source;
	let openFence = false;
	if (options.streaming) {
		const fences = (text.match(/```/g) ?? []).length;
		openFence = fences % 2 === 1;
		if (openFence) text += '\n```';
	}
	return renderMathInText(renderMermaidBlocks(normalizeProse(text), openFence));
}
