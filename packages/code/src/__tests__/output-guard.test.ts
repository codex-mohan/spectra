import { describe, expect, it, vi } from 'vitest';
import { guardToolOutput } from '../security/output-guard.js';

const base = { truncateBytes: 1_000 };

describe('guardToolOutput', () => {
	it('leaves small output untouched', async () => {
		const put = vi.fn();
		const result = await guardToolOutput('shell', { content: [{ type: 'text', text: 'small' }] }, { ...base, artifactDir: '', putArtifact: put });
		expect(result.truncated).toBe(false);
		expect(result.result.content[0]).toMatchObject({ text: 'small' });
		expect(put).not.toHaveBeenCalled();
	});

	it('spills the full body before trimming and keeps head and tail', async () => {
		const body = `${'a'.repeat(60_000)}MIDDLE${'z'.repeat(60_000)}`;
		const put = vi.fn(async () => '42');
		const result = await guardToolOutput('shell', { content: [{ type: 'text', text: body }] }, { ...base, artifactDir: '', putArtifact: put });

		expect(result.truncated).toBe(true);
		expect(put).toHaveBeenCalledWith(body, 'txt');
		const text = (result.result.content[0] as { text: string }).text;
		expect(text.startsWith('a'.repeat(40_000))).toBe(true);
		expect(text.endsWith('z'.repeat(40_000))).toBe(true);
		expect(text).toContain('artifact://42');
		expect(text).not.toContain('MIDDLE');
		expect(result.result.details).toMatchObject({ outputGuard: { truncated: true, artifactId: '42' } });
	});

	it('exempts tools that already bound their output', async () => {
		const put = vi.fn();
		const result = await guardToolOutput('read', { content: [{ type: 'text', text: 'x'.repeat(5_000) }] }, { ...base, artifactDir: '', putArtifact: put });
		expect(result.truncated).toBe(false);
		expect(put).not.toHaveBeenCalled();
	});

	it('can be disabled by setting the threshold to zero', async () => {
		const result = await guardToolOutput('shell', { content: [{ type: 'text', text: 'x'.repeat(5_000) }] }, { truncateBytes: 0, artifactDir: '' });
		expect(result.truncated).toBe(false);
	});
});
