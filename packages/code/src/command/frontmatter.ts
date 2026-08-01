// ---------------------------------------------------------------------------
// Frontmatter parser — extracts structured metadata from template .md files.
// Supports CRLF/LF. No external dependencies.
// ---------------------------------------------------------------------------

import type { TemplateDiagnostic, TemplateFrontmatter, ContextProviderKind } from './template-types.js';

// --- Constants ----------------------------------------------------------------

const VALID_CONTEXT_PROVIDERS: ReadonlySet<string> = new Set(['git.status', 'git.diff']);
const VALID_FIELDS: ReadonlySet<string> = new Set(['description', 'context', 'agent', 'model', 'subtask']);
// --- Result types -------------------------------------------------------------

export interface FrontmatterResult {
	readonly frontmatter: TemplateFrontmatter | null;
	/** JavaScript string offset where the template body begins. */
	readonly bodyOffset: number;
	readonly diagnostics: readonly TemplateDiagnostic[];
}

// --- Public API ---------------------------------------------------------------

/**
 * Optional fields: `description`, `context`, `agent`, `model`, and `subtask`.
 *
 * Returns `null` frontmatter when the block is malformed — diagnostics explain
 * why. Descriptions are allowed to be omitted for Claude-compatible commands;
 * callers derive a title from the command name.
 */
export function parseFrontmatter(raw: string, sourcePath: string): FrontmatterResult {
	const diagnostics: TemplateDiagnostic[] = [];
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
	if (!match) {
		diagnostics.push({
			kind: 'parse',
			sourcePath,
			message: 'Template must start with a closed frontmatter block',
		});
		return { frontmatter: null, bodyOffset: 0, diagnostics };
	}

	const block = match[1].replace(/\r\n/g, '\n');
	let description = '';
	let contextProviders: ContextProviderKind[] | undefined;
	let agent: string | undefined;
	let model: string | undefined;
	let subtask: boolean | undefined;
	const seenKeys = new Set<string>();
	let invalid = false;
	const lines = block.split('\n');

	for (let i = 0; i < lines.length;) {
		const trimmed = lines[i].trim();
		if (trimmed === '') { i++; continue; }
		if (trimmed.startsWith('- ')) {
			diagnostics.push({ kind: 'parse', sourcePath, message: `Unexpected list item "${trimmed}"` });
			invalid = true;
			i++;
			continue;
		}

		const colonIndex = trimmed.indexOf(':');
		if (colonIndex < 1) {
			diagnostics.push({ kind: 'parse', sourcePath, message: `Invalid frontmatter line: "${trimmed}"` });
			invalid = true;
			i++;
			continue;
		}

		const key = trimmed.slice(0, colonIndex).trim();
		const value = trimmed.slice(colonIndex + 1).trim();
		if (seenKeys.has(key)) {
			diagnostics.push({ kind: 'validation', sourcePath, message: `Duplicate frontmatter field "${key}"` });
			invalid = true;
			i++;
			continue;
		}
		seenKeys.add(key);

		if (!VALID_FIELDS.has(key)) {
			diagnostics.push({
				kind: 'validation',
				sourcePath,
				message: `Unsupported frontmatter field "${key}"; supported fields are "description", "context", "agent", "model", and "subtask"`,
			});
			invalid = true;
			i++;
			continue;
		}

		if (key === 'description') {
			description = stripOuterQuotes(value);
			i++;
			continue;
		}

		if (key === 'agent' || key === 'model') {
			const parsed = stripOuterQuotes(value);
			if (!parsed) {
				diagnostics.push({ kind: 'validation', sourcePath, message: `"${key}" must be a non-empty string` });
				invalid = true;
			} else if (key === 'agent') {
				agent = parsed;
			} else {
				model = parsed;
			}
			i++;
			continue;
		}

		if (key === 'subtask') {
			if (value === 'true') subtask = true;
			else if (value === 'false') subtask = false;
			else {
				diagnostics.push({ kind: 'validation', sourcePath, message: '"subtask" must be true or false' });
				invalid = true;
			}
			i++;
			continue;
		}

		if (value !== '') {
			diagnostics.push({ kind: 'validation', sourcePath, message: '"context" must be a YAML-style list' });
			invalid = true;
		}
		contextProviders = [];
		i++;
		while (i < lines.length) {
			const itemLine = lines[i].trim();
			if (itemLine === '') { i++; continue; }
			if (!itemLine.startsWith('- ')) break;
			const provider = stripOuterQuotes(itemLine.slice(2).trim());
			if (!VALID_CONTEXT_PROVIDERS.has(provider)) {
				diagnostics.push({
					kind: 'validation',
					sourcePath,
					message: `Unknown context provider "${provider}"; supported providers are git.status and git.diff`,
				});
				invalid = true;
			} else if (!contextProviders.includes(provider as ContextProviderKind)) {
				contextProviders.push(provider as ContextProviderKind);
			}
			i++;
		}
	}

	if (invalid) return { frontmatter: null, bodyOffset: match[0].length, diagnostics };

	return {
		frontmatter: { description, contextProviders: contextProviders ?? [], agent, model, subtask },
		bodyOffset: match[0].length,
		diagnostics,
	};
}

// --- Internals ----------------------------------------------------------------


/** Strip matching outer single or double quotes. */
function stripOuterQuotes(value: string): string {
	const len = value.length;
	if (len >= 2) {
		const first = value[0];
		const last = value[len - 1];
		if (
			(first === '"' && last === '"') ||
			(first === "'" && last === "'")
		) {
			return value.slice(1, -1);
		}
	}
	return value;
}
