import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveEscapeAction } from '../tui/input/escape-ladder.js';
import { createExitGate, EXIT_CONFIRM_MS } from '../tui/input/exit.js';
import { consumeDraft, saveDraft, clearDraft } from '../services/draft-store.js';
import { layoutFooter } from '../tui/footer-status.js';

describe('escape ladder', () => {
	it.each([
		[{ fileAtActive: true, isStreaming: false, hasDraft: true }, 'ignore'],
		[{ fileAtActive: false, isStreaming: true, hasDraft: true }, 'interrupt'],
		[{ fileAtActive: false, isStreaming: true, hasDraft: false }, 'interrupt'],
		[{ fileAtActive: false, isStreaming: false, hasDraft: true }, 'keep-draft'],
		[{ fileAtActive: false, isStreaming: false, hasDraft: false }, 'none'],
	] as const)('%j resolves to %s', (input, expected) => {
		expect(resolveEscapeAction(input)).toBe(expected);
	});
});

describe('ctrl+c exit gate', () => {
	function gate(overrides: Partial<Parameters<typeof createExitGate>[0]> = {}) {
		let draft = 'draft';
		let clock = 1_000;
		const exited: string[] = [];
		const instance = createExitGate({
			hasDraft: () => draft.trim().length > 0,
			clearDraft: () => { draft = ''; },
			exit: (reason) => exited.push(reason),
			now: () => clock,
			...overrides,
		});
		return {
			instance,
			exited,
			advance: (ms: number) => { clock += ms; },
			setDraft: (text: string) => { draft = text; },
		};
	}

	it('clears a draft without exiting', () => {
		const g = gate();
		expect(g.instance.ctrlC()).toBe('cleared');
		expect(g.exited).toEqual([]);
	});

	it('exits when the next press follows a clear within the window', () => {
		const g = gate();
		expect(g.instance.ctrlC()).toBe('cleared');
		g.advance(EXIT_CONFIRM_MS);
		expect(g.instance.ctrlC()).toBe('exit');
		expect(g.exited).toEqual(['ctrl-c']);
	});

	it('arms on an empty press and does not exit until the next press', () => {
		const g = gate();
		g.setDraft('');
		expect(g.instance.ctrlC()).toBe('armed');
		expect(g.exited).toEqual([]);
		g.advance(EXIT_CONFIRM_MS);
		expect(g.instance.ctrlC()).toBe('exit');
		expect(g.exited).toEqual(['ctrl-c']);
	});

	it('re-arms when the second press is outside the window', () => {
		const g = gate();
		g.setDraft('');
		expect(g.instance.ctrlC()).toBe('armed');
		g.advance(EXIT_CONFIRM_MS + 1);
		expect(g.instance.ctrlC()).toBe('armed');
		expect(g.exited).toEqual([]);
	});

	it('exits immediately on ctrl+d', () => {
		const g = gate();
		expect(g.instance.ctrlD()).toBe('exit');
		expect(g.exited).toEqual(['ctrl-d']);
	});
});

describe('draft store', () => {
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'spectra-draft-'));
		vi.stubEnv('SPECTRA_HOME', home);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(home, { recursive: true, force: true });
	});

	it('round-trips a draft and removes it on consume', () => {
		saveDraft('session-1', 'half typed prompt');
		expect(consumeDraft('session-1')).toBe('half typed prompt');
		expect(consumeDraft('session-1')).toBeNull();
	});

	it('treats whitespace-only text as empty and removes the sidecar', () => {
		saveDraft('session-2', 'draft');
		saveDraft('session-2', '   ');
		expect(consumeDraft('session-2')).toBeNull();
	});

	it('clears a draft explicitly', () => {
		saveDraft('session-3', 'draft');
		clearDraft('session-3');
		expect(existsSync(join(home, 'drafts', 'session-3.txt'))).toBe(false);
	});

	it('never throws when the home directory is unwritable', () => {
		const file = join(home, 'not-a-dir');
		writeFileSync(file, '');
		vi.stubEnv('SPECTRA_HOME', join(file, 'nested'));
		expect(() => saveDraft('session-4', 'draft')).not.toThrow();
		expect(consumeDraft('session-4')).toBeNull();
	});
});

describe('footer interrupt hint', () => {
	it('advertises a single-press interrupt while streaming', () => {
		const layout = layoutFooter(100, '', true, 'Streaming', '');
		expect(layout.hintsText).toBe('esc interrupt');
	});
});
