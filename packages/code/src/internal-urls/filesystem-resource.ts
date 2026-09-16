import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { InternalResource } from './types.js';

export function resolveContainedPath(root: string, relativePath: string): string {
	if (path.isAbsolute(relativePath)) throw new Error('Absolute resource paths are not allowed');
	const resolvedRoot = path.resolve(root);
	const resolved = path.resolve(resolvedRoot, relativePath || '.');
	if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error('Resource path traversal is not allowed');
	}
	return resolved;
}

export async function readFilesystemResource(url: string, targetPath: string, immutable: boolean): Promise<InternalResource> {
	let stat;
	try {
		stat = await fs.stat(targetPath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`Resource not found: ${url}`);
		throw error;
	}

	if (stat.isDirectory()) {
		const entries = await fs.readdir(targetPath, { withFileTypes: true });
		const content = entries
			.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => `${entry.isDirectory() ? 'd' : entry.isSymbolicLink() ? 'l' : 'f'} ${entry.name}${entry.isDirectory() ? '/' : ''}`)
			.join('\n');
		return { url, content, contentType: 'text/plain', size: Buffer.byteLength(content), sourcePath: targetPath, immutable, isDirectory: true };
	}
	if (!stat.isFile()) throw new Error(`Resource is not a regular file: ${url}`);
	if (stat.size > 16 * 1024 * 1024) throw new Error(`Resource exceeds the 16 MiB read limit: ${url}`);

	const content = await fs.readFile(targetPath, 'utf8');
	const extension = path.extname(targetPath).toLowerCase();
	const contentType = extension === '.md' || extension === '.mdx'
		? 'text/markdown' as const
		: extension === '.json'
			? 'application/json' as const
			: 'text/plain' as const;
	return { url, content, contentType, size: Buffer.byteLength(content), sourcePath: targetPath, immutable };
}
