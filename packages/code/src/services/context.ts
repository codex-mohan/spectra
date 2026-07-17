import { createHash } from 'crypto';
import { readFileSync, statSync } from 'fs';
import { dirname, isAbsolute, resolve } from 'path';
import {
	discoverInstructionFileCandidates,
	type InstructionFileCandidate,
	type InstructionSourceKind,
} from '../utils/paths.js';
import { getEnvironmentPrompt, getSystemPrompt } from '../utils/platform.js';
import type { ProjectReferenceConfig } from './config.js';
import type { ContextMessage } from '@mohanscodex/spectra-ai';

const DEFAULT_MAX_IMPORT_DEPTH = 5;
const DEFAULT_MAX_FILE_CHARS = 1_000_000;
const SOURCE_PRIORITY: Record<InstructionSourceKind, number> = {
	spectra: 0,
	agents: 1,
	claude: 2,
	opencode: 3,
	standalone: 4,
};

export interface ContextDiagnostic {
	path: string;
	message: string;
}

export interface ContextSource extends InstructionFileCandidate {
	content: string;
	contentHash: string;
}

export interface ContextResult {
	systemPrompt: string;
	instructions: string[];
	files: string[];
	sources: ContextSource[];
	fingerprint: string;
	diagnostics: ContextDiagnostic[];
}

export interface ContextComposeOptions {
	cwd?: string;
	maxImportDepth?: number;
	maxFileChars?: number;
	includeSystemPrompt?: boolean;
	model?: string;
	provider?: string;
	sessionStartedAt?: Date;
	now?: Date;
	references?: readonly ProjectReferenceConfig[];
}

export function composeContext(options: ContextComposeOptions = {}): ContextResult {
	const cwd = options.cwd ?? process.cwd();
	const diagnostics: ContextDiagnostic[] = [];
	const maxImportDepth = options.maxImportDepth ?? DEFAULT_MAX_IMPORT_DEPTH;
	const maxFileChars = options.maxFileChars ?? DEFAULT_MAX_FILE_CHARS;
	const sources = selectSources(
		discoverInstructionFileCandidates(cwd)
			.map((candidate) => loadSource(candidate, maxImportDepth, maxFileChars, diagnostics))
			.filter((source): source is ContextSource => source !== undefined),
	);
	const instructions = sources.map((source) => source.content);
	const environment = options.model && options.provider
		? getEnvironmentPrompt({ model: options.model, provider: options.provider, cwd, sessionStartedAt: options.sessionStartedAt, now: options.now })
		: '';
	const referencePrompt = renderReferences(options.references ?? [], cwd, diagnostics);
	const renderedSources = sources.map(renderSource);
	const sections = [options.includeSystemPrompt === false ? '' : getSystemPrompt(), environment, referencePrompt, ...renderedSources].filter(Boolean);
	const systemPrompt = sections.join('\n\n');
	return {
		systemPrompt,
		instructions,
		files: sources.map((source) => source.path),
		sources,
		fingerprint: hash([systemPrompt, ...sources.map((source) => `${source.path}:${source.contentHash}`)].join('\n')),
		diagnostics,
	};
}

export function loadContext(cwd?: string, options: Omit<ContextComposeOptions, 'cwd'> = {}): ContextResult {
	return composeContext({ ...options, cwd });
}

export function buildContextMessages(agentPrompt?: string): readonly ContextMessage[] | undefined {
	const prompt = agentPrompt?.trim();
	if (!prompt) return undefined;
	return [{ role: 'developer', content: prompt }];
}

function renderReferences(
	references: readonly ProjectReferenceConfig[],
	cwd: string,
	diagnostics: ContextDiagnostic[],
): string {
	const available = references
		.filter((reference) => reference != null && typeof reference === 'object' && reference.enabled !== false)
		.flatMap((reference) => {
			const name = typeof reference.name === 'string' ? reference.name.trim() : '';
			const configuredPath = typeof reference.path === 'string' ? reference.path.trim() : '';
			if (!name || !configuredPath) {
				diagnostics.push({ path: configuredPath || cwd, message: 'Project reference requires non-empty name and path fields' });
				return [];
			}
			const path = resolve(cwd, configuredPath);
			try {
				if (!statSync(path).isDirectory()) {
					diagnostics.push({ path, message: `Project reference is not a directory: ${name}` });
					return [];
				}
			} catch {
				diagnostics.push({ path, message: `Project reference does not exist: ${name}` });
				return [];
			}
			return [{
				name,
				path,
				description: typeof reference.description === 'string' ? reference.description.trim() : undefined,
			}];
		})
		.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
	if (available.length === 0) return '';
	return [
		'Project references provide additional directories that can be accessed when relevant.',
		'<available-references>',
		...available.flatMap((reference) => [
			'  <reference>',
			`    <name>${escapeText(reference.name)}</name>`,
			`    <path>${escapeText(reference.path)}</path>`,
			...(reference.description ? [`    <description>${escapeText(reference.description)}</description>`] : []),
			'  </reference>',
		]),
		'</available-references>',
	].join('\n');
}

function escapeText(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadSource(
	candidate: InstructionFileCandidate,
	maxImportDepth: number,
	maxFileChars: number,
	diagnostics: ContextDiagnostic[],
): ContextSource | undefined {
	const content = readAndExpand(candidate.path, maxImportDepth, maxFileChars, diagnostics, new Set([resolve(candidate.path)]));
	if (content === undefined) return undefined;
	return { ...candidate, content, contentHash: hash(content) };
}

function readAndExpand(
	path: string,
	maxImportDepth: number,
	maxFileChars: number,
	diagnostics: ContextDiagnostic[],
	visited: Set<string>,
	depth = 0,
): string | undefined {
	let content: string;
	try {
		content = readFileSync(path, 'utf-8').replace(/^\uFEFF/, '');
	} catch (error) {
		diagnostics.push({ path, message: `Unable to read instruction file: ${error instanceof Error ? error.message : String(error)}` });
		return undefined;
	}
	if (content.length > maxFileChars) {
		diagnostics.push({ path, message: `Instruction file exceeds ${maxFileChars} characters` });
		return undefined;
	}
	return content.replace(/^@(?:import[ \t]+)?(.+?)[ \t]*$/gm, (directive, rawPath: string) => {
		const importPath = rawPath.trim().replace(/^(['"])(.*)\1$/, '$2');
		if (!importPath || isAbsolute(importPath)) {
			diagnostics.push({ path, message: `Instruction import must be a non-empty relative path: ${directive}` });
			return directive;
		}
		if (depth >= maxImportDepth) {
			diagnostics.push({ path, message: `Instruction import depth exceeded ${maxImportDepth}: ${directive}` });
			return directive;
		}
		const importedPath = resolve(dirname(path), importPath);
		if (visited.has(importedPath)) {
			diagnostics.push({ path, message: `Instruction import cycle detected: ${importedPath}` });
			return directive;
		}
		const nestedVisited = new Set(visited);
		nestedVisited.add(importedPath);
		return readAndExpand(importedPath, maxImportDepth, maxFileChars, diagnostics, nestedVisited, depth + 1) ?? directive;
	});
}

function selectSources(sources: ContextSource[]): ContextSource[] {
	const selected = new Map<string, ContextSource>();
	for (const source of sources) {
		const current = selected.get(source.contentHash);
		if (!current || compareSourcePreference(source, current) < 0) selected.set(source.contentHash, source);
	}
	const retained = new Set(selected.values());
	return sources.filter((source) => retained.has(source));
}

function compareSourcePreference(left: ContextSource, right: ContextSource): number {
	if (left.scope !== right.scope) return left.scope === 'project' ? -1 : 1;
	if (left.depth !== right.depth) return left.depth - right.depth;
	return SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source];
}

function renderSource(source: ContextSource): string {
	return `<context-file path="${escapeAttribute(source.path)}" scope="${source.scope}" depth="${source.depth}" source="${source.source}">\n${source.content}\n</context-file>`;
}

function escapeAttribute(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}
