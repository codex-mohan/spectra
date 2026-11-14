import { describe, expect, it } from 'vitest';
import { prepareMarkdown } from '../tui/utils/markdown-render.js';

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

	it('combines diagram and math conversion', () => {
		const output = prepareMarkdown('```mermaid\ngraph LR\n  A --> B\n```\n\nthen $x^2$');
		expect(output).toContain('┌───┐');
		expect(output).toContain('x²');
	});
});
