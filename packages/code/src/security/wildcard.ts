import { homedir } from 'os';
import { resolve, relative, normalize, sep } from 'path';

function escapeRegex(pattern: string): string {
	return pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

export function matchWildcard(pattern: string, value: string): boolean {
	let pat = pattern.replace(/^~\//, homedir());

	const parts = pat.split(/(\*|\?)/g);
	let regex = '';
	for (const part of parts) {
		if (part === '*') {
			regex += '.*';
		} else if (part === '?') {
			regex += '.';
		} else {
			regex += escapeRegex(part);
		}
	}

	regex = '^' + regex + '$';

	try {
		const re = new RegExp(regex, process.platform === 'win32' ? 'i' : '');
		return re.test(value);
	} catch {
		return false;
	}
}

export function isInsideWorkingDir(targetPath: string, cwd: string): boolean {
	const abs = resolve(cwd, targetPath);
	const rel = relative(cwd, abs);
	if (rel.startsWith('..')) return false;
	if (process.platform === 'win32') {
		const absLower = abs.toLowerCase();
		const cwdLower = resolve(cwd).toLowerCase();
		return absLower.startsWith(cwdLower + '\\') || absLower.startsWith(cwdLower + '/') || absLower === cwdLower;
	}
	return true;
}

export function canonicalPath(raw: string, cwd: string): string {
	return normalize(resolve(cwd, raw));
}

export function ensureDirGlob(rawPath: string): string {
	return rawPath + sep + '**';
}
