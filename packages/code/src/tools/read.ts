import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { formatHashlineHeader, formatNumberedLine } from './hashline/index.js';
import type { ToolResult } from '@mohanscodex/spectra-agent';
import { z } from 'zod';
import type { Skill } from '@mohanscodex/spectra-agent';
import { ArtifactStore, createInternalUrlRouter, internalScheme, type InternalResource, type InternalUrlRouter, type NamedResource } from '../internal-urls/index.js';
import type { SessionStore } from '../services/session-store.js';
import type { SsrfGuard } from '../security/ssrf-guard.js';
import { readArchiveMember, parseArchivePath } from './archive-reader.js';
import { convertDocument, isConvertibleDocument } from './document-reader.js';
import { imageMimeType, loadImageContent } from './image-reader.js';
import { ReadSnapshotStore } from './read-snapshots.js';
import { materializeRanges, splitReadTarget, type ReadSelector } from './read-selectors.js';
import { parseSqlitePath, readSqlite } from './sqlite-reader.js';
import { summarizeSource } from './source-summary.js';
import type { SpectraTool } from './types.js';
import { errorResult } from './utils.js';

const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_INLINE_CHARS = 240_000;
const DEFAULT_SPILL_LINES = 240;

export interface ReadToolOptions {
	cwd?: string;
	sessionId?: string;
	sessionStore?: SessionStore;
	skills?: ReadonlyMap<string, Skill>;
	rules?: ReadonlyMap<string, NamedResource>;
	artifactDir?: string;
	localDir?: string;
	vaultDir?: string;
	router?: InternalUrlRouter;
	ssrfGuard?: SsrfGuard;
	snapshots?: ReadSnapshotStore;
}

function conflictRanges(lines: string[]): Array<{ start: number; end: number }> {
	const ranges: Array<{ start: number; end: number }> = [];
	let start: number | undefined;
	for (let index = 0; index < lines.length; index++) {
		if (lines[index].startsWith('<<<<<<< ')) start = index + 1;
		if (start !== undefined && lines[index].startsWith('>>>>>>> ')) {
			ranges.push({ start, end: index + 1 });
			start = undefined;
		}
	}
	if (start !== undefined) ranges.push({ start, end: lines.length });
	return ranges;
}

function selectedLines(content: string, selector: ReadSelector | undefined, offset?: number, limit?: number): { text: string; seenLines: number[] } {
	if (selector?.kind === 'raw') return { text: content, seenLines: [] };
	const lines = content.split(/\r?\n/);
	const ranges = selector?.kind === 'conflicts'
		? conflictRanges(lines)
		: materializeRanges(selector, lines.length, offset, limit);
	const output: string[] = [];
	const seenLines: number[] = [];
	for (const [rangeIndex, range] of ranges.entries()) {
		if (rangeIndex > 0) output.push('');
		for (let line = Math.max(1, range.start); line <= Math.min(lines.length, range.end); line++) {
			output.push(formatNumberedLine(line, lines[line - 1]));
			seenLines.push(line);
		}
	}
	return { text: output.join('\n'), seenLines };
}

async function readPath(target: string, cwd: string): Promise<InternalResource> {
	const resolved = path.resolve(cwd, target);
	let stat;
	try {
		stat = await fs.stat(resolved);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`File not found: ${resolved}`);
		throw error;
	}
	if (stat.isDirectory()) {
		const entries = await fs.readdir(resolved, { withFileTypes: true });
		const content = entries.sort((left, right) => left.name.localeCompare(right.name))
			.map((entry) => `${entry.isDirectory() ? 'd' : entry.isSymbolicLink() ? 'l' : 'f'} ${entry.name}${entry.isDirectory() ? '/' : ''}`).join('\n');
		return { url: resolved, content, contentType: 'text/plain', size: Buffer.byteLength(content), sourcePath: resolved, immutable: false, isDirectory: true };
	}
	if (!stat.isFile()) throw new Error(`Not a regular file: ${resolved}`);
	if (stat.size > MAX_READ_BYTES) throw new Error(`File exceeds the ${MAX_READ_BYTES / 1024 / 1024} MiB read limit: ${resolved}`);
	if (isConvertibleDocument(resolved)) {
		const content = await convertDocument(resolved);
		return { url: resolved, content, contentType: 'text/markdown', size: Buffer.byteLength(content), sourcePath: resolved, immutable: false };
	}
	const content = await fs.readFile(resolved, 'utf8');
	const extension = path.extname(resolved).toLowerCase();
	const contentType = extension === '.md' || extension === '.mdx' ? 'text/markdown' as const : extension === '.json' ? 'application/json' as const : 'text/plain' as const;
	return { url: resolved, content, contentType, size: stat.size, sourcePath: resolved, immutable: false };
}

async function readHttp(target: string, guard: SsrfGuard | undefined, signal?: AbortSignal): Promise<InternalResource> {
	const safety = guard?.check(target);
	if (safety && !safety.ok) throw new Error(safety.reason);
	const response = await fetch(target, { signal, redirect: guard?.followRedirects ? 'follow' : 'error' });
	if (!response.ok) throw new Error(`HTTP read failed: ${response.status} ${response.statusText}`);
	const declaredSize = Number(response.headers.get('content-length') ?? 0);
	if (declaredSize > MAX_READ_BYTES) throw new Error(`HTTP resource exceeds the ${MAX_READ_BYTES / 1024 / 1024} MiB read limit`);
	const content = await response.text();
	if (Buffer.byteLength(content) > MAX_READ_BYTES) throw new Error(`HTTP resource exceeds the ${MAX_READ_BYTES / 1024 / 1024} MiB read limit`);
	const mime = response.headers.get('content-type')?.split(';')[0].trim();
	const contentType = mime === 'application/json' ? 'application/json' as const : mime === 'text/markdown' ? 'text/markdown' as const : 'text/plain' as const;
	return { url: response.url || target, content, contentType, size: Buffer.byteLength(content), immutable: true };
}

function result(content: ToolResult['content'], isError = false): ToolResult {
	return { content, isError };
}

export function createReadTool(options: ReadToolOptions = {}): SpectraTool {
	const cwd = path.resolve(options.cwd ?? process.cwd());
	const router = options.router ?? createInternalUrlRouter();
	const artifactDir = options.artifactDir ?? path.join(cwd, '.spectra', 'artifacts');
	const snapshots = options.snapshots ?? new ReadSnapshotStore();
	return {
		name: 'read',
		capabilities: { reads: true, writes: false },
		description: `Read files, directories, documents, images, archives, SQLite data, HTTP(S) URLs, or internal resources through one interface.
Internal schemes: ${router.listSchemes().map((scheme) => `${scheme}://`).join(', ')}.
Read archive members with archive.ext:member/path. Read SQLite tables with database.sqlite:table, rows with database.sqlite:table:key, and read-only SQL with ?q=SELECT....
Append :N, :N-M, :N+K, :N-, :raw, or :conflicts to select content. Large unselected output becomes artifact://<id>; read the relevant artifact range instead of repeating work.
Source files may return a structural summary with an explicit re-read selector. Mutable text files include [path#TAG] anchors for the hashline edit tool.`,
		parameters: z.object({
			path: z.string().describe('File path, archive member, SQLite selector, HTTP(S) URL, or internal resource URI with an optional selector'),
			offset: z.number().int().min(1).optional().describe('Starting line number, 1-indexed'),
			limit: z.number().int().min(1).optional().describe('Maximum number of lines'),
		}),
		execute: async ({ path: input, offset, limit }, toolContext) => {
			try {
				const split = splitReadTarget(input);
				const scheme = internalScheme(split.target);
				const archive = !scheme ? parseArchivePath(split.target, cwd) : undefined;
				const sqlite = !scheme && !archive ? parseSqlitePath(split.target, cwd) : undefined;
				const localImagePath = !scheme && !archive && !sqlite && !/^https?:\/\//i.test(split.target) && imageMimeType(split.target)
					? path.resolve(cwd, split.target)
					: undefined;
				if (localImagePath) {
					const loaded = await loadImageContent(localImagePath);
					return result([{ type: 'text', text: loaded.note }, loaded.image]);
				}
				let resource: InternalResource;
				if (scheme && router.canHandle(split.target)) {
					try {
						resource = await router.resolve(split.target, { cwd, signal: toolContext.signal, sessionId: options.sessionId, sessionStore: options.sessionStore, skills: options.skills, rules: options.rules, artifactDir, localDir: options.localDir, vaultDir: options.vaultDir });
					} catch (error) {
						if (!split.opaqueFallback) throw error;
						resource = await router.resolve(split.opaqueFallback.target, { cwd, signal: toolContext.signal, sessionId: options.sessionId, sessionStore: options.sessionStore, skills: options.skills, rules: options.rules, artifactDir, localDir: options.localDir, vaultDir: options.vaultDir });
						split.selector = split.opaqueFallback.selector;
					}
				} else if (/^https?:\/\//i.test(split.target)) {
					resource = await readHttp(split.target, options.ssrfGuard, toolContext.signal);
				} else if (scheme) {
					throw new Error(`Unsupported resource protocol: ${scheme}://\nSupported: ${router.listSchemes().map((item) => `${item}://`).join(', ')}`);
				} else if (archive) {
					const member = await readArchiveMember(archive);
					resource = { url: split.target, content: member.content, contentType: 'text/plain', size: Buffer.byteLength(member.content), immutable: true, isDirectory: member.isDirectory };
				} else if (sqlite) {
					const content = readSqlite(sqlite);
					resource = { url: split.target, content, contentType: 'application/json', size: Buffer.byteLength(content), immutable: true };
				} else {
					resource = await readPath(split.target, cwd);
				}

				const hasSelection = split.selector !== undefined || offset !== undefined || limit !== undefined;
				if (!hasSelection && resource.sourcePath && !resource.isDirectory && !resource.immutable) {
					const summary = summarizeSource(resource.content, resource.sourcePath);
					if (summary) {
						const tag = await snapshots.record(resource.sourcePath, resource.content, summary.elidedRanges.flatMap((range) => [range.start, range.end]));
						const header = tag ? `${formatHashlineHeader(resource.sourcePath, tag)}\n` : '';
						return result([{ type: 'text', text: `${header}${summary.content}` }]);
					}
				}

				let content = resource.content;
				let spillNote = '';
				if (!hasSelection && content.length > MAX_INLINE_CHARS) {
					const artifactId = await new ArtifactStore(artifactDir).put(content, resource.contentType === 'application/json' ? 'json' : resource.contentType === 'text/markdown' ? 'md' : 'txt');
					content = content.split(/\r?\n/).slice(0, DEFAULT_SPILL_LINES).join('\n');
					spillNote = `\n\n[Output truncated after ${DEFAULT_SPILL_LINES} lines. Full content: artifact://${artifactId}]`;
				}
				const selected = selectedLines(content, split.selector, offset, limit);
				const tag = resource.sourcePath && !resource.isDirectory && !resource.immutable && split.selector?.kind !== 'raw'
					? await snapshots.record(resource.sourcePath, resource.content, selected.seenLines)
					: undefined;
				const header = tag ? `${formatHashlineHeader(resource.sourcePath!, tag)}\n` : '';
				const details = [resource.url, resource.contentType, resource.immutable ? 'immutable' : 'mutable', resource.isDirectory ? 'directory' : undefined].filter(Boolean).join(' | ');
				return result([{ type: 'text', text: `${header}[${details}]\n${selected.text}${spillNote}` }]);
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};
}

export const readTool = createReadTool();
