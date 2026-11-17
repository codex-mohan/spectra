import { renderMermaidASCII } from 'beautiful-mermaid';
import stringWidth from 'string-width';
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

function isTableSeparator(line: string): boolean {
	return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitCells(line: string): string[] {
	const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
	return trimmed.split('|').map((cell) => cell.trim());
}

function cleanCell(value: string): string {
	return value.replace(/\*\*|__|`/g, '');
}

function renderTable(header: string[], rows: string[][]): string {
	const columns = Math.max(header.length, ...rows.map((row) => row.length));
	const widths = Array.from({ length: columns }, (_, index) => Math.max(1, ...[header, ...rows].map((row) => stringWidth(cleanCell(row[index] ?? '')))));
	const border = (left: string, middle: string, right: string): string =>
		`${left}${widths.map((width) => '─'.repeat(width + 2)).join(middle)}${right}`;
	const line = (cells: string[]): string =>
		`│ ${widths.map((width, index) => {
			const cell = cleanCell(cells[index] ?? '');
			return `${cell}${' '.repeat(width - stringWidth(cell))}`;
		}).join(' │ ')} │`;
	return [border('┌', '┬', '┐'), line(header), border('├', '┼', '┤'), ...rows.map(line), border('└', '┴', '┘')].join('\n');
}

/** Split Markdown pipe tables containing complex scripts into preformatted text. */
function splitComplexTables(source: string): MarkdownSegment[] {
	const lines = source.split('\n');
	const segments: MarkdownSegment[] = [];
	let markdown: string[] = [];
	const flush = (): void => {
		if (markdown.length > 0) {
			segments.push({ kind: 'markdown', text: markdown.join('\n') });
			markdown = [];
		}
	};
	for (let index = 0; index < lines.length; index++) {
		const headerLine = lines[index] ?? '';
		const separator = lines[index + 1];
		if (!headerLine.includes('|') || separator === undefined || !isTableSeparator(separator)) {
			markdown.push(headerLine);
			continue;
		}
		const header = splitCells(headerLine);
		const rows: string[][] = [];
		let cursor = index + 2;
		while (cursor < lines.length) {
			const row = lines[cursor] ?? '';
			if (!row.includes('|') || row.trim().length === 0) break;
			rows.push(splitCells(row));
			cursor++;
		}
		const complex = [header, ...rows].some((row) => row.some((cell) => hasComplexScript(cell)));
		if (!complex) {
			markdown.push(headerLine, separator, ...rows.map((row) => lines[index + 2 + rows.indexOf(row)] ?? ''));
			index = cursor - 1;
			continue;
		}
		flush();
		segments.push({ kind: 'pre', text: renderTable(header, rows) });
		index = cursor - 1;
	}
	flush();
	return segments;
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

/** Split complex-script code fences and Markdown tables into preformatted segments. */
export function splitComplexBlocks(source: string): MarkdownSegment[] {
	const segments: MarkdownSegment[] = [];
	for (const segment of splitComplexCodeFences(source)) {
		if (segment.kind === 'pre') segments.push(segment);
		else segments.push(...splitComplexTables(segment.text));
	}
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
