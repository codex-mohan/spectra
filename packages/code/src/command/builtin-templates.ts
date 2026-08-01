// ---------------------------------------------------------------------------
// Built-in prompt templates — common conversational recipes supplied through
// the same CommandDefinition path as user templates. Each definition returns
// a `submit_prompt` action, so the dispatcher treats them identically to
// template-loader output. Merge order note: register these BEFORE legacy
// command definitions so collisions resolve in favor of these definitions.
// No external dependencies; pure TypeScript.
// ---------------------------------------------------------------------------

import type { CommandContext, CommandDefinition, CommandResult } from './types.js';

// --- Argument handling --------------------------------------------------------

/**
 * Compose final prompt text from a template body and raw user args.
 * Mirrors template-renderer semantics without Markdown loading:
 *  1. If the body contains `$ARGUMENTS`, substitute the full arg string.
 *  2. Otherwise, when args are non-empty, append them as a trailing paragraph.
 * Args are trimmed; empty args leave the body untouched.
 */
function composePrompt(body: string, args: string): string {
	const trimmed = args.trim();
	if (trimmed.length === 0) return body;
	if (body.includes('$ARGUMENTS')) {
		return body.replace(/\$ARGUMENTS/g, trimmed);
	}
	return `${body}\n\n${trimmed}`;
}

// --- Prompt bodies ------------------------------------------------------------

const COMMIT_PROMPT = `Review the current working tree and produce a commit.

1. Inspect the staged and unstaged changes (git status, git diff).
2. Group related edits into one coherent change; if unrelated changes are present, identify them and ask before committing everything together.
3. Write a commit message following the repository's existing convention (imperative mood, concise subject line under 72 characters, body explaining the "why" when non-obvious).
4. Stage the appropriate files and create the commit. Do not commit files that look like build artifacts, secrets, or local configuration.
5. Report the resulting commit hash and subject line.`;

const REVIEW_PROMPT = `Perform a code review of the current changes.

1. Examine the diff of the working tree (or the changes described below) with a reviewer's eye: correctness, edge cases, error handling, security, performance, and readability.
2. Flag concrete issues ordered by severity — blockers first, then concerns, then nits. Reference the file and line or code region for each finding.
3. For each issue, suggest a specific fix or improvement, not just criticism.
4. Acknowledge what the change does well so good patterns are reinforced.
5. End with a clear verdict: approve, approve with comments, or request changes.`;

const EXPLAIN_PROMPT = `Explain the following code or concept clearly and precisely.

1. State what it does at a high level in one or two sentences before diving into details.
2. Walk through the important parts step by step, matching the reader's likely level of familiarity with this codebase.
3. Call out non-obvious behavior, side effects, invariants, and any coupling to other parts of the system.
4. Use short concrete examples where they clarify behavior.
5. Conclude with any caveats, common pitfalls, or follow-up areas worth exploring.`;

const BUILD_FIX_PROMPT = `Diagnose and fix the build failure.

1. Run the project's build or typecheck command and capture the full error output.
2. Identify the root cause of the first failure — do not patch symptoms or suppress diagnostics to make errors disappear.
3. Fix the underlying problem at its source, following existing code conventions in the touched files.
4. Re-run the build to confirm the fix, then address any newly surfaced errors the same way.
5. Summarize what was broken and what you changed to fix it.`;

// --- Command definitions ------------------------------------------------------

const COMMIT_COMMAND: CommandDefinition = {
	id: 'builtin:template:commit',
	name: 'commit',
	aliases: [],
	title: 'Commit changes',
	description: 'Review the working tree and create a well-formed git commit.',
	category: 'Templates',
	source: 'builtin',
	sourceInfo: { label: 'Built-in template: commit' },
	execute: (ctx: CommandContext): CommandResult => ({
		type: 'submit_prompt',
		text: composePrompt(COMMIT_PROMPT, ctx.args),
	}),
};

const REVIEW_COMMAND: CommandDefinition = {
	id: 'builtin:template:review',
	name: 'review',
	aliases: [],
	title: 'Review code',
	description: 'Review the current diff or described changes with actionable findings.',
	category: 'Templates',
	source: 'builtin',
	sourceInfo: { label: 'Built-in template: review' },
	execute: (ctx: CommandContext): CommandResult => ({
		type: 'submit_prompt',
		text: composePrompt(REVIEW_PROMPT, ctx.args),
	}),
};

const EXPLAIN_COMMAND: CommandDefinition = {
	id: 'builtin:template:explain',
	name: 'explain',
	aliases: [],
	title: 'Explain code',
	description: 'Explain a piece of code or concept step by step.',
	category: 'Templates',
	source: 'builtin',
	sourceInfo: { label: 'Built-in template: explain' },
	execute: (ctx: CommandContext): CommandResult => ({
		type: 'submit_prompt',
		text: composePrompt(EXPLAIN_PROMPT, ctx.args),
	}),
};

const BUILD_FIX_COMMAND: CommandDefinition = {
	id: 'builtin:template:build-fix',
	name: 'build-fix',
	aliases: [],
	title: 'Fix build failure',
	description: 'Diagnose build or typecheck errors and fix them at the source.',
	category: 'Templates',
	source: 'builtin',
	sourceInfo: { label: 'Built-in template: build-fix' },
	execute: (ctx: CommandContext): CommandResult => ({
		type: 'submit_prompt',
		text: composePrompt(BUILD_FIX_PROMPT, ctx.args),
	}),
};

// --- Public API -----------------------------------------------------------------

/**
 * Built-in prompt template commands (`/commit`, `/review`, `/explain`,
 * `/build-fix`). Register these before legacy command definitions so name
 * collisions resolve in their favor; user templates registered earlier still
 * win over these, matching the registry's first-registration-wins rule.
 */
export const BUILTIN_TEMPLATE_COMMANDS: readonly CommandDefinition[] = [
	COMMIT_COMMAND,
	REVIEW_COMMAND,
	EXPLAIN_COMMAND,
	BUILD_FIX_COMMAND,
];
