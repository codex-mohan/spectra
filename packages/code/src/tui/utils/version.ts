import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 10; i++) {
		const pkgPath = resolve(dir, 'package.json');
		if (existsSync(pkgPath)) {
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
				if (pkg.name === '@mohanscodex/spectra-code') return pkg.version;
			} catch {}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return '0.0.0';
}

export const VERSION = findVersion();
