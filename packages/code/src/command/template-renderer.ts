// ---------------------------------------------------------------------------
// Template renderer — $ARGUMENTS / $1..$N substitution, context placeholders.
// Rejects backtick-command syntax. No external dependencies.
// ---------------------------------------------------------------------------

import type { TemplateDiagnostic } from './template-types.js';

// --- Types --------------------------------------------------------------------

export interface RenderContext {
	/** Raw argument string from the user. */
	readonly args: string;
	/** Resolved context values keyed by provider (e.g. "git.status"). */
	readonly contextValues: ReadonlyMap<string, string>;
	/** Providers declared in frontmatter (order matters for fallback appending). */
	readonly declaredProviders: readonly string[];
}

export interface RenderResult {
	readonly text: string;
	readonly diagnostics: readonly TemplateDiagnostic[];
}

// --- Constants ----------------------------------------------------------------

const DOLLAR_ARGS_RE = /\$ARGUMENTS/g;
const DOLLAR_REF_RE = /\$(\d+)/g;
const BACKTICK_CMD_RE = /!`[^`]*`/;

// --- Public API ---------------------------------------------------------------

/**
 * Render a template body by:
 *  1. Replacing `$ARGUMENTS` with the full argument string.
 *  2. Replacing `$1`..`$N` with quote-aware split argument parts.
 *  3. If no `$`-placeholder exists and args are non-empty, appending args as a paragraph.
 *  4. Replacing `{{context.git.status}}` / `{{context.git.diff}}` placeholders.
 *  5. Appending declared-but-unplaced providers in labeled fenced sections.
 *  6. Rejecting `!`...` `` backtick-command syntax.
 */
export function renderTemplate(
	body: string,
	sourcePath: string,
	ctx: RenderContext,
): RenderResult {
	const diagnostics: TemplateDiagnostic[] = [];
	let text = body;

	// --- reject backtick-command syntax ---------------------------------------
	if (BACKTICK_CMD_RE.test(text)) {
		diagnostics.push({
			kind: 'validation',
			sourcePath,
			message: 'Template body contains forbidden backtick-command syntax (!`...`)',
		});
	}

	// --- $ARGUMENTS substitution ----------------------------------------------
	const hasDollarPlaceholder = DOLLAR_ARGS_RE.test(text) || DOLLAR_REF_RE.test(text);
	// Reset lastIndex after regex test (both are global).
	DOLLAR_ARGS_RE.lastIndex = 0;
	DOLLAR_REF_RE.lastIndex = 0;

	if (DOLLAR_ARGS_RE.test(text)) {
		DOLLAR_ARGS_RE.lastIndex = 0;
		text = text.replace(DOLLAR_ARGS_RE, () => ctx.args);
	}

	// --- $1..$N quote-aware substitution --------------------------------------
	const parts = splitArgsQuoted(ctx.args);
	DOLLAR_REF_RE.lastIndex = 0;
	text = text.replace(DOLLAR_REF_RE, (_match, rawIndex: string) => {
		const index = Number.parseInt(rawIndex, 10);
		return index > 0 && index <= parts.length ? parts[index - 1] : '';
	});

	// --- no-placeholder fallback: append args as paragraph --------------------
	if (!hasDollarPlaceholder && ctx.args.trim() !== '') {
		text = text.trimEnd() + '\n\n' + ctx.args;
	}

	// --- context placeholders ------------------------------------------------
	const usedProviders = new Set<string>();
	for (const [key, value] of ctx.contextValues) {
		const placeholder = `{{context.${key}}}`;
		if (text.includes(placeholder)) {
			text = text.replaceAll(placeholder, value);
			usedProviders.add(key);
		}
	}
	for (const match of text.matchAll(/\{\{context\.([^}]+)\}\}/g)) {
		const provider = match[1];
		if (!ctx.declaredProviders.includes(provider)) {
			diagnostics.push({
				kind: 'validation',
				sourcePath,
				message: `Context placeholder "${provider}" is not declared in frontmatter`,
			});
		}
	}

	// --- append declared providers that weren't used as placeholders ----------
	const appended: string[] = [];
	for (const provider of ctx.declaredProviders) {
		if (!usedProviders.has(provider) && ctx.contextValues.has(provider)) {
			const label = provider === 'git.status' ? 'Git Status' : 'Git Diff';
			const value = ctx.contextValues.get(provider)!;
			appended.push(`## ${label}\n\n\`\`\`\n${value}\n\`\`\``);
		}
	}

	if (appended.length > 0) {
		text = text.trimEnd() + '\n\n' + appended.join('\n\n');
	}

	return { text, diagnostics };
}

// --- Internals ----------------------------------------------------------------


/**
 * Split an argument string respecting single and double quotes.
 * Unmatched quotes are tolerated (treated as unterminated).
 *
 * `foo "hello world" bar` → `["foo", "hello world", "bar"]`
 */
function splitArgsQuoted(args: string): string[] {
	if (args.trim() === '') return [];
	const parts: string[] = [];
	let current = '';
	let inSingle = false;
	let inDouble = false;
	let escaped = false;

	for (let i = 0; i < args.length; i++) {
		const ch = args[i];

		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}

		if (ch === '\\' && (inSingle || inDouble)) {
			const next = args[i + 1];
			const quote = inSingle ? "'" : '"';
			if (next === quote || next === '\\') {
				escaped = true;
				continue;
			}
		}

		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
			continue;
		}
		if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
			continue;
		}
		if ((ch === ' ' || ch === '\t') && !inSingle && !inDouble) {
			if (current.length > 0) {
				parts.push(current);
				current = '';
			}
			continue;
		}

		current += ch;
	}

	if (current.length > 0) parts.push(current);
	return parts;
}
