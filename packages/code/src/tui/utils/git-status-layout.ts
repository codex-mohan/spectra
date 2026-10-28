import { c } from '../tokens.js';
import type { GitStatus } from '../../services/git-status.js';
import { glyphFor } from './icons.js';

export type GitElementKind =
	| 'folder'
	| 'path'
	| 'separator'
	| 'branchGlyph'
	| 'branch'
	| 'detached'
	| 'ahead'
	| 'behind'
	| 'changed'
	| 'untracked'
	| 'conflict';

export interface GitElement {
	text: string;
	kind: GitElementKind;
}

const ELEMENT_COLORS: Record<GitElementKind, string> = {
	folder: c.warn,
	path: c.text,
	separator: c.dim,
	branchGlyph: c.accent,
	branch: c.warn,
	detached: c.dim,
	ahead: c.success,
	behind: c.warn,
	changed: c.warn,
	untracked: c.dim,
	conflict: c.error,
};

export function formatCwd(cwd: string, home: string): string {
	const trimmedHome = home.replace(/[\\/]+$/, '');
	const relative = trimmedHome && cwd.toLowerCase().startsWith(trimmedHome.toLowerCase())
		? `~${cwd.slice(trimmedHome.length)}`
		: cwd;
	return relative.replace(/\\/g, '/');
}

export function tailPath(path: string, segments: number): string {
	const parts = path.split('/').filter(Boolean);
	if (parts.length <= segments) return path;
	return `…/${parts.slice(-segments).join('/')}`;
}

function truncate(text: string, max: number): string {
	if (max <= 0) return '';
	if (text.length <= max) return text;
	if (max === 1) return '…';
	return `${text.slice(0, max - 1)}…`;
}

export function renderedWidth(elements: readonly GitElement[]): number {
	return elements.reduce((total, element) => total + element.text.length, 0) + Math.max(0, elements.length - 1);
}

/**
 * Build the footer elements, dropping lower-priority parts until they fit.
 * Priority: folder + path, conflicts, changed, untracked, branch, sync.
 */
export function layoutGitStatus(input: {
	cwd: string;
	home: string;
	status: GitStatus | null;
	maxWidth: number;
}): GitElement[] {
	const folder = glyphFor('folder');
	const separator = glyphFor('chevron');
	const branchGlyph = glyphFor('branch');
	const path = formatCwd(input.cwd, input.home);
	const status = input.status;

	const wide = input.maxWidth >= 80;
	const medium = input.maxWidth >= 50;
	const narrow = input.maxWidth >= 30;

	const countElements: GitElement[] = [];
	if (status) {
		if (status.conflicted > 0) countElements.push({ text: `!${status.conflicted}`, kind: 'conflict' });
		const changed = status.staged + status.modified;
		if (changed > 0) countElements.push({ text: `*${changed}`, kind: 'changed' });
		if (status.untracked > 0) countElements.push({ text: `?${status.untracked}`, kind: 'untracked' });
	}

	const syncElements: GitElement[] = [];
	if (status && wide && !status.detached) {
		if (status.ahead > 0) syncElements.push({ text: `↑${status.ahead}`, kind: 'ahead' });
		if (status.behind > 0) syncElements.push({ text: `↓${status.behind}`, kind: 'behind' });
	}

	const branchElements: GitElement[] = [];
	if (status && status.branch && narrow) {
		const maxBranch = wide ? 32 : medium ? 20 : 12;
		branchElements.push({ text: separator, kind: 'separator' });
		branchElements.push({ text: branchGlyph, kind: 'branchGlyph' });
		branchElements.push({ text: truncate(status.branch, maxBranch), kind: 'branch' });
		if (status.detached) branchElements.push({ text: '(detached)', kind: 'detached' });
	}

	const segments = wide ? 3 : medium ? 2 : 1;
	const pathElement: GitElement = { text: tailPath(path, segments), kind: 'path' };
	let elements: GitElement[] = [{ text: folder, kind: 'folder' }, pathElement, ...branchElements, ...syncElements, ...countElements];

	const dropOrder: Array<() => void> = [
		() => { elements = elements.filter((el) => !syncElements.includes(el)); },
		() => { elements = elements.filter((el) => el.kind !== 'untracked'); },
		() => { elements = elements.filter((el) => el.kind !== 'changed'); },
		() => { elements = elements.filter((el) => !branchElements.includes(el)); },
		() => { elements = elements.filter((el) => el.kind !== 'behind' && el.kind !== 'ahead'); },
	];

	for (const drop of dropOrder) {
		if (renderedWidth(elements) <= input.maxWidth) break;
		drop();
	}

	if (renderedWidth(elements) > input.maxWidth) {
		const lastSegment = tailPath(path, 1);
		elements = elements.map((el) => (el.kind === 'path' ? { text: lastSegment, kind: 'path' } : el));
	}

	if (renderedWidth(elements) > input.maxWidth) {
		const fixed = renderedWidth(elements.filter((el) => el.kind !== 'path'));
		const budget = Math.max(0, input.maxWidth - fixed - 1);
		elements = elements.map((el) => (
			el.kind === 'path' ? { text: truncate(el.text, budget), kind: 'path' } as GitElement : el
		));
	}

	return elements.filter((el) => el.text.length > 0 && el.text.length <= input.maxWidth);
}

export function gitElementColor(kind: GitElementKind): string {
	return ELEMENT_COLORS[kind];
}
