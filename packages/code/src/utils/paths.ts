import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { existsSync, readdirSync, statSync } from 'fs';

export function getSpectraHomeDir(): string {
	const override = process.env.SPECTRA_HOME?.trim();
	return override ? resolve(override) : join(homedir(), '.spectra');
}

export function getGlobalConfigDir(): string {
	return getSpectraHomeDir();
}

export function getGlobalDataDir(): string {
	return getSpectraHomeDir();
}

export function getGlobalCacheDir(): string {
	return join(getSpectraHomeDir(), 'cache');
}

export function getGlobalStateDir(): string {
	return join(getSpectraHomeDir(), 'state');
}

export interface DiscoveredDir {
	path: string;
	base: string;
}

function ancestorDirs(startDir: string): string[] {
	const dirs: string[] = [];
	const home = resolve(homedir());
	let current = resolve(startDir);
	while (true) {
		dirs.push(current);
		if (current === home) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return dirs.reverse();
}

function appendExistingDir(dirs: DiscoveredDir[], candidate: string, base: string): void {
	if (!existsSync(candidate) || dirs.some((entry) => entry.path === candidate)) return;
	dirs.push({ path: candidate, base });
}

/** Spectra application configuration only: global first, then project layers from root to cwd. */
export function discoverConfigDirs(startDir: string): DiscoveredDir[] {
	const dirs: DiscoveredDir[] = [];
	const global = getGlobalConfigDir();
	appendExistingDir(dirs, global, global);
	const home = resolve(homedir());
	for (const base of ancestorDirs(startDir)) {
		if (base !== home) appendExistingDir(dirs, join(base, '.spectra'), base);
	}
	return dirs;
}

/** Compatible instruction/tool assets. Foreign directories are never application config sources. */
export function discoverCompatibilityDirs(startDir: string): DiscoveredDir[] {
	const dirs: DiscoveredDir[] = [];
	const global = getGlobalConfigDir();
	appendExistingDir(dirs, global, global);
	const home = resolve(homedir());
	for (const base of ancestorDirs(startDir)) {
		for (const target of ['.spectra', '.opencode', '.claude', '.agents']) {
			if (base === home && target === '.spectra') continue;
			appendExistingDir(dirs, join(base, target), base);
		}
	}
	return dirs;
}

export type InstructionSourceKind = 'spectra' | 'agents' | 'claude' | 'opencode' | 'standalone';

export interface InstructionFileCandidate {
	path: string;
	scope: 'global' | 'project';
	depth: number;
	source: InstructionSourceKind;
}

const INSTRUCTION_NAMES = ['AGENTS.md', 'CLAUDE.md', 'SPECTRA.md', 'INSTRUCTIONS.md'] as const;
const COMPATIBILITY_SOURCES: ReadonlyArray<{ directory: string; source: Exclude<InstructionSourceKind, 'standalone'> }> = [
	{ directory: '.spectra', source: 'spectra' },
	{ directory: '.agents', source: 'agents' },
	{ directory: '.claude', source: 'claude' },
	{ directory: '.opencode', source: 'opencode' },
];

function sourceForInstructionName(name: typeof INSTRUCTION_NAMES[number]): InstructionSourceKind {
	if (name === 'SPECTRA.md') return 'spectra';
	if (name === 'AGENTS.md') return 'agents';
	if (name === 'CLAUDE.md') return 'claude';
	return 'standalone';
}

function appendInstructionCandidates(
	candidates: InstructionFileCandidate[],
	dir: string,
	scope: InstructionFileCandidate['scope'],
	depth: number,
	source: InstructionSourceKind,
): void {
	const instructionsDir = join(dir, 'instructions');
	if (existsSync(instructionsDir) && statSync(instructionsDir).isDirectory()) {
		for (const entry of readdirSync(instructionsDir).filter((entry) => entry.endsWith('.md')).sort()) {
			candidates.push({ path: join(instructionsDir, entry), scope, depth, source });
		}
	}
	for (const name of INSTRUCTION_NAMES) {
		const path = join(dir, name);
		if (existsSync(path)) candidates.push({ path, scope, depth, source });
	}
}

export function discoverInstructionFileCandidates(startDir: string): InstructionFileCandidate[] {
	const candidates: InstructionFileCandidate[] = [];
	const global = getGlobalConfigDir();
	appendInstructionCandidates(candidates, global, 'global', Number.MAX_SAFE_INTEGER, 'spectra');

	const ancestors = ancestorDirs(startDir);
	const home = resolve(homedir());
	for (const [index, base] of ancestors.entries()) {
		const depth = ancestors.length - index - 1;
		for (const name of INSTRUCTION_NAMES) {
			const path = join(base, name);
			if (existsSync(path)) candidates.push({ path, scope: 'project', depth, source: sourceForInstructionName(name) });
		}
		for (const { directory, source } of COMPATIBILITY_SOURCES) {
			if (base === home && directory === '.spectra') continue;
			const compatibilityDir = join(base, directory);
			if (existsSync(compatibilityDir)) {
				appendInstructionCandidates(candidates, compatibilityDir, 'project', depth, source);
			}
		}
	}

	return candidates;
}

export function discoverInstructionFiles(startDir: string): string[] {
	return discoverInstructionFileCandidates(startDir).map((candidate) => candidate.path);
}
