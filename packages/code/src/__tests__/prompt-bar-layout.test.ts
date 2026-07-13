import { describe, expect, it } from 'vitest';
import { resolvePromptBarWidths } from '../tui/prompt-layout.js';

describe('PromptBar layout', () => {
	it('keeps an explicit root width after the first provider supplies a model', () => {
		expect(resolvePromptBarWidths(68)).toEqual({ rootWidth: 68, bodyWidth: 67 });
	});

	it('preserves automatic sizing when no width is supplied', () => {
		expect(resolvePromptBarWidths()).toEqual({ rootWidth: 'auto', bodyWidth: 'auto' });
	});
});
