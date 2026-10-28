import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePorcelainV2, readGitStatus } from '../services/git-status.js';
import { formatCwd, layoutGitStatus, renderedWidth, tailPath } from '../tui/utils/git-status-layout.js';

const STATUS = {
	branch: 'feat/new-beginning',
	detached: false,
	ahead: 2,
	behind: 1,
	staged: 2,
	modified: 1,
	untracked: 1,
	conflicted: 1,
};

describe('porcelain v2 parsing', () => {
	it('reads branch, divergence, and working-tree counts', () => {
		const output = [
			'# branch.oid 0123456789abcdef',
			'# branch.head feat/new-beginning',
			'# branch.upstream origin/feat/new-beginning',
			'# branch.ab +2 -1',
			'1 M. N... 100644 100644 100644 aaa bbb staged.ts',
			'2 R. N... 100644 100644 100644 ccc ddd renamed.ts',
			'1 .M N... 100644 100644 100644 eee eee modified.ts',
			'u UU N... 100644 100644 100644 100644 fff ggg hhh conflict.ts',
			'? untracked.ts',
		].join('\n');

		expect(parsePorcelainV2(output)).toEqual({
			branch: 'feat/new-beginning',
			detached: false,
			ahead: 2,
			behind: 1,
			staged: 2,
			modified: 1,
			untracked: 1,
			conflicted: 1,
		});
	});

	it('uses the short oid for a detached HEAD', () => {
		const status = parsePorcelainV2('# branch.oid 0123456789abcdef\n# branch.head (detached)\n');
		expect(status.detached).toBe(true);
		expect(status.branch).toBe('0123456');
	});
});

describe('readGitStatus', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it('reports a temporary repository', () => {
		dir = mkdtempSync(join(tmpdir(), 'spectra-git-status-'));
		const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		run('init', '-b', 'main');
		run('config', 'user.email', 'test@example.com');
		run('config', 'user.name', 'Test');
		writeFileSync(join(dir, 'tracked.txt'), 'one\n');
		run('add', 'tracked.txt');
		run('commit', '-m', 'init');

		expect(readGitStatus(dir)).toMatchObject({ branch: 'main', staged: 0, modified: 0, untracked: 0 });

		writeFileSync(join(dir, 'tracked.txt'), 'two\n');
		writeFileSync(join(dir, 'new.txt'), 'new\n');
		expect(readGitStatus(dir)).toMatchObject({ branch: 'main', modified: 1, untracked: 1 });
	});

	it('returns null outside a repository', () => {
		dir = mkdtempSync(join(tmpdir(), 'spectra-no-git-'));
		expect(readGitStatus(dir)).toBeNull();
	});
});

describe('path formatting', () => {
	it('shortens the home directory and normalizes separators', () => {
		expect(formatCwd('C:\\Users\\me\\project', 'C:\\Users\\me')).toBe('~/project');
		expect(formatCwd('/home/me/project', '/home/me')).toBe('~/project');
	});

	it('keeps the tail of a long path', () => {
		expect(tailPath('~/Development/Major-Projects/spectra', 2)).toBe('…/Major-Projects/spectra');
		expect(tailPath('~/spectra', 2)).toBe('~/spectra');
	});
});

describe('footer layout', () => {
	const base = { cwd: '/home/me/Development/Major-Projects/spectra', home: '/home/me', status: STATUS };

	it('shows everything that fits at full width', () => {
		const elements = layoutGitStatus({ ...base, maxWidth: 120 });
		const kinds = elements.map((element) => element.kind);
		expect(kinds).toContain('folder');
		expect(kinds).toContain('branch');
		expect(kinds).toContain('ahead');
		expect(kinds).toContain('behind');
		expect(kinds).toContain('conflict');
		expect(renderedWidth(elements)).toBeLessThanOrEqual(120);
	});

	it('drops sync before counts at medium width', () => {
		const elements = layoutGitStatus({ ...base, maxWidth: 60 });
		const kinds = elements.map((element) => element.kind);
		expect(kinds).not.toContain('ahead');
		expect(kinds).toContain('conflict');
		expect(renderedWidth(elements)).toBeLessThanOrEqual(60);
	});

	it('truncates the branch before dropping it', () => {
		const elements = layoutGitStatus({ ...base, maxWidth: 40 });
		const branch = elements.find((element) => element.kind === 'branch');
		expect(branch?.text.endsWith('…')).toBe(true);
		expect(renderedWidth(elements)).toBeLessThanOrEqual(40);
	});

	it('keeps counts when the branch no longer fits', () => {
		const elements = layoutGitStatus({ ...base, maxWidth: 24 });
		const kinds = elements.map((element) => element.kind);
		expect(kinds).not.toContain('branch');
		expect(kinds).toContain('conflict');
		expect(renderedWidth(elements)).toBeLessThanOrEqual(24);
	});

	it('omits the branch segment outside a repository', () => {
		const elements = layoutGitStatus({ ...base, status: null, maxWidth: 100 });
		expect(elements.map((element) => element.kind)).not.toContain('separator');
		expect(elements.map((element) => element.kind)).not.toContain('branch');
	});
});
