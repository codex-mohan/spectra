import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/** A workspace-wide project checker used when LSP workspace diagnostics are unavailable. */
export interface ProjectChecker {
	type: 'rust' | 'typescript' | 'go' | 'python';
	description: string;
	command: string;
	args: string[];
}

const MAX_CONCURRENT_CHECKERS = 2;
const MAX_OUTPUT_LINES = 50;

/** Parse `go.work` use directives into `go build` package patterns. */
function goWorkPatterns(cwd: string): string[] {
	let text: string;
	try {
		text = readFileSync(join(cwd, 'go.work'), 'utf8');
	} catch {
		return ['./...'];
	}
	text = text.replace(/\/\/[^\n]*/g, '');
	const patterns = new Set<string>();
	const addPattern = (raw: string): void => {
		const value = raw.trim().replace(/^"|"$/g, '');
		if (!value) return;
		if (value === '.') patterns.add('./...');
		else if (value.endsWith('/...')) patterns.add(value);
		else if (value.startsWith('./') || value.startsWith('../')) patterns.add(`${value}/...`);
		else patterns.add(`./${value}/...`);
	};
	for (const block of text.matchAll(/use\s*\(([^)]*)\)/g)) {
		for (const line of block[1].split('\n')) addPattern(line);
	}
	for (const single of text.matchAll(/^\s*use\s+(\S+)\s*$/gm)) addPattern(single[1]);
	return patterns.size > 0 ? [...patterns] : ['./...'];
}

/**
 * Detect project-wide checkers from root markers. Unlike LSP server detection
 * this does not need any language server to be installed — it uses the
 * project's own toolchain, which is normally present already.
 */
export function detectProjectCheckers(cwd: string): ProjectChecker[] {
	const has = (name: string): boolean => existsSync(join(cwd, name));
	const checkers: ProjectChecker[] = [];
	if (has('Cargo.toml')) {
		checkers.push({
			type: 'rust',
			description: 'Rust (cargo check)',
			command: 'cargo',
			args: ['check', '--message-format=short'],
		});
	}
	if (has('tsconfig.json')) {
		checkers.push({
			type: 'typescript',
			description: 'TypeScript (tsc --noEmit)',
			command: 'npx',
			args: ['tsc', '--noEmit'],
		});
	}
	if (has('go.work') || has('go.mod')) {
		checkers.push({
			type: 'go',
			description: 'Go (go build)',
			command: 'go',
			args: ['build', ...(has('go.work') ? goWorkPatterns(cwd) : ['./...'])],
		});
	}
	if (has('pyproject.toml') || has('pyrightconfig.json')) {
		checkers.push({
			type: 'python',
			description: 'Python (pyright)',
			command: 'pyright',
			args: [],
		});
	}
	return checkers;
}

interface CheckerRun {
	description: string;
	ok: boolean;
	output: string;
	exitCode: number | null;
}

function runChecker(checker: ProjectChecker, cwd: string, signal?: AbortSignal): Promise<CheckerRun> {
	const { promise, resolve } = Promise.withResolvers<CheckerRun>();
	let stdout = '';
	let stderr = '';
	let settled = false;
	const finish = (run: CheckerRun): void => {
		if (settled) return;
		settled = true;
		signal?.removeEventListener('abort', onAbort);
		resolve(run);
	};
	const onAbort = (): void => {
		child.kill();
		finish({ description: checker.description, ok: false, output: '', exitCode: null });
	};
	const child = spawn(checker.command, checker.args, {
		cwd,
		// npm-installed tools are `.cmd` launchers on Windows.
		shell: process.platform === 'win32',
		windowsHide: true,
	});
	signal?.addEventListener('abort', onAbort, { once: true });
	child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
	child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
	child.on('error', (error) => {
		finish({ description: checker.description, ok: false, output: error.message, exitCode: null });
	});
	child.on('close', (code) => {
		finish({
			description: checker.description,
			ok: code === 0,
			output: `${stdout}${stderr}`.trim(),
			exitCode: code,
		});
	});
	return promise;
}

function limitLines(text: string): string {
	const lines = text.split('\n');
	if (lines.length <= MAX_OUTPUT_LINES) return text;
	return `${lines.slice(0, MAX_OUTPUT_LINES).join('\n')}\n… ${lines.length - MAX_OUTPUT_LINES} more line(s)`;
}

async function runWithConcurrency(checkers: ProjectChecker[], cwd: string, signal?: AbortSignal): Promise<CheckerRun[]> {
	const runs: CheckerRun[] = new Array(checkers.length);
	let cursor = 0;
	const worker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;
			const checker = checkers[index];
			if (index >= checkers.length || !checker) return;
			runs[index] = await runChecker(checker, cwd, signal);
		}
	};
	await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKERS, checkers.length) }, worker));
	return runs;
}

/**
 * Run project-wide diagnostics without a language server.
 *
 * Returns `null` when the workspace has no recognized project marker, so the
 * caller can fall back to an LSP sweep. This is the `diagnostics "*"` path that
 * keeps a fresh checkout useful before any server binary is available.
 */
export async function runWorkspaceCheckers(
	cwd: string,
	signal?: AbortSignal,
): Promise<{ text: string; ok: boolean } | null> {
	if (signal?.aborted) return null;
	const checkers = detectProjectCheckers(cwd);
	if (checkers.length === 0) return null;

	const runs = await runWithConcurrency(checkers, cwd, signal);
	if (signal?.aborted) {
		return { text: 'Workspace diagnostics were interrupted.', ok: false };
	}

	const sections = runs.map((run) => {
		let output = run.output;
		if (!output) {
			output = run.exitCode === 0
				? 'No issues found'
				: `Failed to run ${run.description.split(' (')[0]}: exited with code ${run.exitCode ?? 'unknown'} without reporting anything, so the workspace was not verified`;
		}
		return { description: run.description, output: limitLines(output) };
	});
	const text = sections.length === 1
		? sections[0].output
		: sections.map((section) => `=== ${section.description} ===\n${section.output}`).join('\n\n');
	return { text, ok: runs.every((run) => run.ok) };
}
