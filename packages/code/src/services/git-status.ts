import { execFileSync } from 'child_process';

export interface GitStatus {
	branch: string;
	detached: boolean;
	ahead: number;
	behind: number;
	staged: number;
	modified: number;
	untracked: number;
	conflicted: number;
}

/**
 * Parse `git status --porcelain=v2 --branch` into a compact status.
 *
 * Header lines carry the branch, upstream divergence, and detached oid;
 * entry lines start with `1` (ordinary), `2` (rename), `u` (unmerged), or `?`.
 */
export function parsePorcelainV2(output: string): GitStatus {
	let branch = '';
	let detached = false;
	let oid = '';
	let ahead = 0;
	let behind = 0;
	let staged = 0;
	let modified = 0;
	let untracked = 0;
	let conflicted = 0;

	for (const line of output.split('\n')) {
		if (line.startsWith('# branch.oid ')) {
			const value = line.slice('# branch.oid '.length).trim();
			if (value !== '(initial)') oid = value;
			continue;
		}
		if (line.startsWith('# branch.head ')) {
			const value = line.slice('# branch.head '.length).trim();
			if (value === '(detached)') detached = true;
			else branch = value;
			continue;
		}
		if (line.startsWith('# branch.ab ')) {
			const match = /^\+(\d+)\s+-(\d+)/.exec(line.slice('# branch.ab '.length).trim());
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
			continue;
		}
		if (line.startsWith('? ')) {
			untracked++;
			continue;
		}
		if (line.startsWith('u ')) {
			conflicted++;
			continue;
		}
		if (line.startsWith('1 ') || line.startsWith('2 ')) {
			const x = line[2];
			const y = line[3];
			if (x !== '.' && x !== ' ') staged++;
			if (y !== '.' && y !== ' ') modified++;
		}
	}

	if (detached) branch = oid ? oid.slice(0, 7) : 'detached';
	return { branch, detached, ahead, behind, staged, modified, untracked, conflicted };
}

/** Read the branch and working-tree counts. Returns null outside a repository or when git is unavailable. */
export function readGitStatus(cwd = process.cwd()): GitStatus | null {
	const options = {
		cwd,
		encoding: 'utf8' as const,
		timeout: 2000,
		stdio: ['ignore', 'pipe', 'ignore'] as ['ignore', 'pipe', 'ignore'],
		windowsHide: true,
	};
	try {
		const porcelain = execFileSync('git', ['status', '--porcelain=v2', '--branch'], options);
		return parsePorcelainV2(porcelain);
	} catch {
		return null;
	}
}

export function sameGitStatus(a: GitStatus | null, b: GitStatus | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return a.branch === b.branch
		&& a.detached === b.detached
		&& a.ahead === b.ahead
		&& a.behind === b.behind
		&& a.staged === b.staged
		&& a.modified === b.modified
		&& a.untracked === b.untracked
		&& a.conflicted === b.conflicted;
}
