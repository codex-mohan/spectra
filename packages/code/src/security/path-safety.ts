import { existsSync } from 'fs';
import { resolve, relative } from 'path';
import type { PathSafetyResult } from './types.js';
import { matchWildcard } from './wildcard.js';

const DEFAULT_BLOCKED = [
	'**/.ssh/**',
	'**/.aws/credentials',
	'**/.aws/config',
	'**/.gnupg/**',
	'**/.netrc',
	'**/etc/shadow',
	'**/etc/gshadow',
	'**/etc/sudoers',
	'**/.password-store/**',
	'**/.docker/config.json',
	'**/.kube/config',
];

interface PathSafetyConfig {
	blockedPaths: string[];
	allowedPaths: string[];
}

export class PathSafety {
	private blocked: string[];
	private allowed: string[];

	constructor(config?: Partial<PathSafetyConfig>) {
		this.blocked = config?.blockedPaths ?? [...DEFAULT_BLOCKED];
		this.allowed = config?.allowedPaths ?? [];
	}

	check(rawPath: string, cwd: string = process.cwd()): PathSafetyResult {
		if (rawPath.includes('\0')) {
			return { ok: false, reason: 'Path contains null bytes' };
		}

		const resolved = resolve(cwd, rawPath);

		if (this.isAllowed(resolved)) {
			return { ok: true, resolvedPath: resolved, displayPath: relative(cwd, resolved) || resolved };
		}

		if (this.isBlocked(resolved)) {
			return { ok: false, reason: `Access denied to sensitive path: ${relative(cwd, resolved) || resolved}` };
		}

		return { ok: true, resolvedPath: resolved, displayPath: relative(cwd, resolved) || resolved };
	}

	private isBlocked(fullPath: string): boolean {
		for (const pattern of this.blocked) {
			if (matchWildcard('**/' + pattern, fullPath) || matchWildcard(pattern, fullPath)) {
				return true;
			}
			const suffixIdx = pattern.replace(/^(\*\*\/)+/, '');
			if (fullPath.replace(/\\/g, '/').endsWith('/' + suffixIdx)) {
				return true;
			}
		}
		return false;
	}

	private isAllowed(fullPath: string): boolean {
		for (const pattern of this.allowed) {
			if (matchWildcard(pattern, fullPath) || matchWildcard('**/' + pattern, fullPath)) {
				return true;
			}
		}
		return false;
	}
}
