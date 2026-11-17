import { describe, expect, it } from 'vitest';
import { prepareMarkdown, splitComplexBlocks, splitComplexCodeFences } from '../tui/utils/markdown-render.js';

describe('markdown preparation', () => {
	it('renders mermaid fences as terminal diagrams', () => {
		const output = prepareMarkdown('```mermaid\ngraph LR\n  A --> B\n```');
		expect(output).toContain('A');
		expect(output).toContain('B');
		expect(output).toContain('┌───┐');
		expect(output).not.toContain('```mermaid');
	});

	it('leaves other fences and invalid diagrams untouched', () => {
		const code = '```ts\nconst x = 1;\n```';
		expect(prepareMarkdown(code)).toBe(code);
		const invalid = '```mermaid\nnot a diagram\n```';
		expect(prepareMarkdown(invalid)).toBe(invalid);
	});

	it('normalizes prose without touching code', () => {
		expect(prepareMarkdown('cafe\u0301')).toBe('café');
		expect(prepareMarkdown('`e\u0301`')).toBe('`e\u0301`');
	});

	it('closes an open fence while streaming and does not render it as a diagram', () => {
		const output = prepareMarkdown('```ts\nconst x = 1', { streaming: true });
		expect(output.endsWith('```')).toBe(true);
		expect(output).toContain('const x = 1');
	});

	it('extracts complex-script code fences for preformatted rendering', () => {
		const segments = splitComplexCodeFences('intro\n```\nஉஜ்ஜயினி 123\n```\noutro');
		expect(segments.map((segment) => segment.kind)).toEqual(['markdown', 'pre', 'markdown']);
		expect(segments[1].text).toContain('உஜ்ஜயினி');
		const ascii = splitComplexCodeFences('```ts\nconst x = 1;\n```');
		expect(ascii).toEqual([{ kind: 'markdown', text: '```ts\nconst x = 1;\n```' }]);
	});

	it('renders complex-script Markdown tables as preformatted text', () => {
		const segments = splitComplexBlocks('| Rasi | Value |\n|---|---|\n| சிம்மம் | 15? |');
		expect(segments.map((segment) => segment.kind)).toEqual(['pre']);
		expect(segments[0].text).toContain('சிம்மம்');
		expect(segments[0].text).toContain('┌');
		const ascii = splitComplexBlocks('| a | b |\n|---|---|\n| 1 | 2 |');
		expect(ascii).toEqual([{ kind: 'markdown', text: '| a | b |\n|---|---|\n| 1 | 2 |' }]);
	});

	it('combines diagram and math conversion', () => {
		const output = prepareMarkdown('```mermaid\ngraph LR\n  A --> B\n```\n\nthen $x^2$');
		expect(output).toContain('┌───┐');
		expect(output).toContain('x²');
	});
});
