// ---------------------------------------------------------------------------
// Context providers — safe fixed-arg git context gathering via execFile.
// No shell, no user input in args, bounded output, timeout.
// ---------------------------------------------------------------------------

import { execFile } from 'child_process';
import type { ContextProviderKind, TemplateDiagnostic } from './template-types.js';

// --- Constants ----------------------------------------------------------------

const GIT_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 50 * 1024; // 50 KB bounded output

// --- Types --------------------------------------------------------------------

export interface GatherContextResult {
	/** Resolved context values keyed by provider name. */
	readonly values: ReadonlyMap<string, string>;
	readonly diagnostics: readonly TemplateDiagnostic[];
}

// --- Public API ---------------------------------------------------------------

/**
 * Gather git context for the declared providers.
 *
 * Each provider maps to a fixed `execFile` call — no shell, no user input
 * in arguments, bounded output, and a hard timeout.  Failed providers produce
 * diagnostics (with source path and provider name) and an empty-string value
 * so rendering degrades gracefully.
 */
export async function gatherContext(
	providers: readonly ContextProviderKind[],
	cwd: string,
	sourcePath: string,
): Promise<GatherContextResult> {
	const values = new Map<string, string>();
	const diagnostics: TemplateDiagnostic[] = [];

	for (const provider of providers) {
		const result = await runGitForProvider(provider, cwd);
		if (result.ok) {
			values.set(provider, result.output);
		} else {
			diagnostics.push({
				kind: 'load',
				sourcePath,
				message: `Context provider "${provider}" failed: ${result.error}`,
			});
			// Empty string so placeholders degrade gracefully.
			values.set(provider, '');
		}
	}

	return { values, diagnostics };
}

// --- Internals ----------------------------------------------------------------

interface GitProviderResult {
	readonly ok: boolean;
	readonly output: string;
	readonly error?: string;
}

/**
 * Run a fixed-arg git command for a single provider.
 *
 * - `git.status` → `git status --short`
 * - `git.diff`   → `git diff --no-ext-diff`
 */
function runGitForProvider(
	provider: ContextProviderKind,
	cwd: string,
): Promise<GitProviderResult> {
	const args = provider === 'git.status'
		? ['status', '--short']
		: ['diff', '--no-ext-diff'];

	return new Promise((resolve) => {
		execFile('git', args, {
			cwd,
			timeout: GIT_TIMEOUT_MS,
			maxBuffer: MAX_OUTPUT_BYTES,
			encoding: 'utf-8',
			windowsHide: true,
		}, (error, stdout, stderr) => {
			if (error) {
				resolve({
					ok: false,
					output: '',
					error: stderr.trim() || error.message,
				});
				return;
			}
			resolve({ ok: true, output: stdout.trim() });
		});
	});
}
