import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { unzipSync } from 'fflate';

const ZIP_EXTENSIONS = ['.zip', '.jar', '.war', '.ear', '.apk', '.whl', '.epub', '.docx', '.xlsx', '.pptx'] as const;
const TAR_EXTENSIONS = ['.tar.gz', '.tgz', '.tar'] as const;
const ARCHIVE_EXTENSIONS = [...TAR_EXTENSIONS, ...ZIP_EXTENSIONS].sort((left, right) => right.length - left.length);
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const MAX_MEMBER_BYTES = 64 * 1024 * 1024;

export interface ArchivePath {
	archivePath: string;
	memberPath: string;
	format: 'zip' | 'tar';
}

function normalizeMemberPath(value: string): string {
	const parts: string[] = [];
	for (const part of value.replace(/\\/g, '/').split('/')) {
		if (!part || part === '.') continue;
		if (part === '..') throw new Error('Archive member traversal is not allowed');
		parts.push(part);
	}
	return parts.join('/');
}

export function parseArchivePath(input: string, cwd: string): ArchivePath | undefined {
	const lower = input.toLowerCase();
	for (const extension of ARCHIVE_EXTENSIONS) {
		let index = lower.indexOf(`${extension}:`);
		while (index !== -1) {
			const archiveText = input.slice(0, index + extension.length);
			const archivePath = path.resolve(cwd, archiveText);
			const memberPath = normalizeMemberPath(input.slice(index + extension.length + 1));
			return { archivePath, memberPath, format: ZIP_EXTENSIONS.includes(extension as typeof ZIP_EXTENSIONS[number]) ? 'zip' : 'tar' };
		}
	}
	return undefined;
}

export interface ArchiveReadResult {
	content: string;
	isDirectory: boolean;
	memberPath: string;
}

function formatListing(paths: string[], prefix: string): string {
	const entries = new Map<string, boolean>();
	const normalizedPrefix = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
	for (const entryPath of paths) {
		if (!entryPath.startsWith(normalizedPrefix)) continue;
		const remainder = entryPath.slice(normalizedPrefix.length);
		if (!remainder) continue;
		const slash = remainder.indexOf('/');
		const name = slash === -1 ? remainder : remainder.slice(0, slash);
		entries.set(name, slash !== -1 || entryPath.endsWith('/'));
	}
	return [...entries.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, directory]) => `${directory ? 'd' : 'f'} ${name}${directory ? '/' : ''}`)
		.join('\n');
}

export async function readArchiveMember(candidate: ArchivePath): Promise<ArchiveReadResult> {
	const stat = await fs.stat(candidate.archivePath);
	if (stat.size > MAX_ARCHIVE_BYTES) throw new Error(`Archive exceeds ${MAX_ARCHIVE_BYTES / 1024 / 1024} MiB: ${candidate.archivePath}`);
	const bytes = await fs.readFile(candidate.archivePath);
	if (candidate.format === 'zip') {
		const entries = unzipSync(bytes, {
			filter: (file) => file.originalSize <= MAX_MEMBER_BYTES,
		});
		const names = Object.keys(entries).map(normalizeMemberPath);
		if (!candidate.memberPath || !entries[candidate.memberPath]) {
			const listing = formatListing(names, candidate.memberPath);
			if (!listing && candidate.memberPath) throw new Error(`Archive member not found: ${candidate.memberPath}`);
			return { content: listing, isDirectory: true, memberPath: candidate.memberPath };
		}
		const member = entries[candidate.memberPath];
		if (member.byteLength > MAX_MEMBER_BYTES) throw new Error(`Archive member exceeds ${MAX_MEMBER_BYTES / 1024 / 1024} MiB`);
		return { content: new TextDecoder('utf-8', { fatal: false }).decode(member), isDirectory: false, memberPath: candidate.memberPath };
	}

	const archive = new Bun.Archive(bytes);
	const files = await archive.files();
	const names = [...files.keys()].map(normalizeMemberPath);
	const member = files.get(candidate.memberPath);
	if (!candidate.memberPath || !member) {
		const listing = formatListing(names, candidate.memberPath);
		if (!listing && candidate.memberPath) throw new Error(`Archive member not found: ${candidate.memberPath}`);
		return { content: listing, isDirectory: true, memberPath: candidate.memberPath };
	}
	if (member.size > MAX_MEMBER_BYTES) throw new Error(`Archive member exceeds ${MAX_MEMBER_BYTES / 1024 / 1024} MiB`);
	return { content: await member.text(), isDirectory: false, memberPath: candidate.memberPath };
}
