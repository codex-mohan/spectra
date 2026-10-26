import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@opentui/core', () => ({
	RGBA: class RGBA {
		static fromHex(value: string) { return value; }
	},
	SyntaxStyle: class SyntaxStyle {
		static fromStyles(value: unknown) { return value; }
	},
}));

import { iconForCommand } from '../tui/utils/icons.js';

const previousNerdFont = process.env.SPECTRA_NERD_FONT;

afterEach(() => {
	if (previousNerdFont === undefined) delete process.env.SPECTRA_NERD_FONT;
	else process.env.SPECTRA_NERD_FONT = previousNerdFont;
});

describe('command icons', () => {
	it('uses the flat Material Design glyph for a builtin command', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		expect(iconForCommand({ id: 'builtin:new' }).glyph).toBe('\u{f0415}');
		expect(iconForCommand({ id: 'builtin:settings' }).glyph).toBe('\u{f0493}');
	});

	it('matches ids with or without the builtin prefix', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		expect(iconForCommand({ id: 'skills' }).glyph).toBe('\u{f1844}');
	});

	it('falls back to the same id mapping for aliased invocations', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		expect(iconForCommand({ id: 'builtin:provider' }).glyph).toBe('\u{f06a5}');
	});

	it('maps template ids by bare id and sources only for unknown ids', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		expect(iconForCommand({ id: 'template:commit', source: 'template' }).glyph).toBe('\u{f012c}');
		expect(iconForCommand({ id: 'template:brand-new', source: 'template' }).glyph).toBe('\u{f09ee}');
		expect(iconForCommand({ id: 'skill:ai-elements', source: 'skill' }).glyph).toBe('\u{f1844}');
	});

	it('falls back to the terminal glyph for unknown commands', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		expect(iconForCommand({ id: 'plugin:mystery', source: 'plugin' }).glyph).toBe('\u{f018d}');
	});

	it('switches to the plain emoji fallback when Nerd Font is unavailable', () => {
		process.env.SPECTRA_NERD_FONT = '0';

		const icon = iconForCommand({ id: 'builtin:new' });
		expect(icon.glyph).toBe('➕');
		expect(icon.color).toBeTruthy();
	});

	it('keeps a flat palette color for every icon', () => {
		process.env.SPECTRA_NERD_FONT = '1';

		for (const id of ['builtin:new', 'builtin:doctor', 'template:x', 'skill:y', 'unknown']) {
			expect(iconForCommand({ id })).toMatchObject({ color: expect.stringMatching(/^#/) });
		}
	});
});
