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

export function discoverInstructionFiles(startDir: string): string[] {
	const files: string[] = [];
	const names = ['AGENTS.md', 'CLAUDE.md', 'SPECTRA.md', 'INSTRUCTIONS.md'];

	for (const dir of ancestorDirs(startDir)) {
		for (const name of names) {
			const candidate = join(dir, name);
			if (existsSync(candidate) && !files.includes(candidate)) {
				files.push(candidate);
			}
		}
	}

	const dirs = discoverCompatibilityDirs(startDir);
	for (const d of dirs) {
		const instructionsDir = join(d.path, 'instructions');
		if (existsSync(instructionsDir) && statSync(instructionsDir).isDirectory()) {
			for (const entry of readdirSync(instructionsDir)) {
				if (entry.endsWith('.md')) {
					files.push(join(instructionsDir, entry));
				}
			}
		}
		for (const name of names) {
			const candidate = join(d.path, name);
			if (existsSync(candidate) && !files.includes(candidate)) {
				files.push(candidate);
			}
		}
	}

	return files;
}
