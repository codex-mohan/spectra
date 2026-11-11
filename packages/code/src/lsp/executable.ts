import { existsSync, readdirSync, statSync } from 'fs';
import { delimiter, extname, isAbsolute, join, resolve } from 'path';

/** Windows launchers written by npm/bun package managers. */
const WINDOWS_EXTENSIONS = ['.exe', '.cmd', '.bat'] as const;

interface LocalBinRule {
	/** One of these entries in the project root enables the bin directories. */
	markers: string[];
	/** Bin directories checked before `$PATH`. */
	dirs: string[];
}

const PYTHON_MARKERS = [
	'pyproject.toml',
	'ty.toml',
	'requirements.txt',
	'setup.py',
	'setup.cfg',
	'Pipfile',
	'pyrightconfig.json',
	'ruff.toml',
	'.ruff.toml',
];

const LOCAL_BIN_RULES: LocalBinRule[] = [
	// npm / bun / yarn / pnpm
	{ markers: ['package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'], dirs: ['node_modules/.bin'] },
	// Python virtual environments, POSIX and Windows layouts
	{ markers: PYTHON_MARKERS, dirs: ['.venv/bin', '.venv/Scripts', 'venv/bin', 'venv/Scripts', '.env/bin', '.env/Scripts'] },
	// Ruby bundler and binstubs
	{ markers: ['Gemfile', 'Gemfile.lock'], dirs: ['vendor/bundle/bin', 'bin'] },
	// Go installs project binaries into ./bin by convention
	{ markers: ['go.mod', 'go.sum', 'go.work'], dirs: ['bin'] },
];

function isFile(candidate: string): boolean {
	try {
		return statSync(candidate).isFile();
	} catch {
		return false;
	}
}

/** Windows resolves bare names through PATHEXT; mirror that for explicit paths. */
function executableCandidates(base: string): string[] {
	if (process.platform !== 'win32') return [base];
	const extension = extname(base).toLowerCase();
	if ((WINDOWS_EXTENSIONS as readonly string[]).includes(extension)) return [base];
	// npm/bun write both a POSIX shell shim (no extension) and a `.cmd` launcher.
	// Windows cannot execute the extensionless shim, so prefer PATHEXT forms.
	return [...WINDOWS_EXTENSIONS.map((suffix) => `${base}${suffix}`), base];
}

export function hasRootMarker(root: string, markers: readonly string[]): boolean {
	return markers.some((marker) => {
		if (!marker.includes('*')) return existsSync(join(root, marker));
		const pattern = new RegExp(
			`^${marker.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`,
			'i',
		);
		try {
			return readdirSync(root).some((name) => pattern.test(name));
		} catch {
			return false;
		}
	});
}

/**
 * Resolve a server command to an executable, preferring project-local bins
 * (npm/bun, Python virtualenvs, Ruby binstubs, Go `/bin`) before `$PATH`.
 *
 * Mirrors what users expect from an editor: a `typescript-language-server`
 * installed in the project works without a global install, and binary
 * resolution is stable regardless of where the agent was launched from.
 */
export function resolveExecutable(command: string, searchRoot: string): string | null {
	if (!command) return null;

	if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
		const base = isAbsolute(command) ? command : resolve(searchRoot, command);
		for (const candidate of executableCandidates(base)) {
			if (isFile(candidate)) return candidate;
		}
		return null;
	}

	for (const rule of LOCAL_BIN_RULES) {
		if (!rule.markers.some((marker) => existsSync(join(searchRoot, marker)))) continue;
		for (const dir of rule.dirs) {
			for (const candidate of executableCandidates(join(searchRoot, dir, command))) {
				if (isFile(candidate)) return candidate;
			}
		}
	}

	const pathValue = process.env.PATH ?? '';
	for (const dir of pathValue.split(delimiter)) {
		if (!dir) continue;
		for (const candidate of executableCandidates(join(dir, command))) {
			if (isFile(candidate)) return candidate;
		}
	}
	return null;
}
