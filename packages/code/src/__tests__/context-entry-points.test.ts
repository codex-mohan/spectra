import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildSubagentSystemPrompt } from '../tools/task.js';
import { buildAcpSystemPrompt } from '../integrations/acp/server.js';
import { composeContext, buildContextMessages } from '../services/context.js';

let tempDir: string;
let previousSpectraHome: string | undefined;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'spectra-entry-context-'));
	previousSpectraHome = process.env.SPECTRA_HOME;
	process.env.SPECTRA_HOME = join(tempDir, 'home', '.spectra');
});

afterEach(() => {
	if (previousSpectraHome === undefined) delete process.env.SPECTRA_HOME;
	else process.env.SPECTRA_HOME = previousSpectraHome;
	rmSync(tempDir, { recursive: true, force: true });
});

function writeInstruction(cwd: string): void {
	mkdirSync(cwd, { recursive: true });
	writeFileSync(join(cwd, 'AGENTS.md'), 'Project instruction from AGENTS.\n');
}

const NOW = new Date(2026, 6, 16, 12, 0, 0);
const SESSION_STARTED = new Date('2026-07-16T11:55:00.000Z');

describe('secondary agent context entry points', () => {
	it('stable system prompt contains project instructions and environment', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const prompt = buildSubagentSystemPrompt(cwd, {
			model: 'claude-sonnet-4-20250514',
			provider: 'anthropic',
			sessionStartedAt: SESSION_STARTED,
			now: NOW,
		});

		expect(prompt).toContain('Project instruction from AGENTS.');
		expect(prompt).toContain('<env>');
		expect(prompt).toContain('anthropic/claude-sonnet-4-20250514');
		expect(prompt).toContain(SESSION_STARTED.toISOString());
		expect(prompt).toContain("Today's date: 2026-07-16");
	});

	it('stable system prompt does NOT contain agent prompt or memory', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const prompt = buildSubagentSystemPrompt(cwd);

		expect(prompt).not.toContain('Subagent role prompt.');
		expect(prompt).not.toContain('<memory>');
		expect(prompt).not.toContain('Runtime knowledge policy');
	});

	it('buildContextMessages returns developer message for agent prompt', () => {
		const msgs = buildContextMessages('Subagent role prompt.');

		expect(msgs).toBeDefined();
		expect(msgs).toHaveLength(1);
		expect(msgs![0].role).toBe('developer');
		expect(msgs![0].content).toBe('Subagent role prompt.');
	});

	it('buildContextMessages returns undefined for empty/missing prompt', () => {
		expect(buildContextMessages(undefined)).toBeUndefined();
		expect(buildContextMessages('')).toBeUndefined();
		expect(buildContextMessages('   ')).toBeUndefined();
	});

	it('ACP stable system prompt contains project instructions but not agent prompt or memory', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const prompt = buildAcpSystemPrompt(cwd, {
			model: 'gpt-4o',
			provider: 'openai',
			sessionStartedAt: SESSION_STARTED,
			now: NOW,
		});

		expect(prompt).toContain('Project instruction from AGENTS.');
		expect(prompt).not.toContain('ACP role prompt.');
		expect(prompt).not.toContain('<memory>');
		expect(prompt).not.toContain('Runtime knowledge policy');
		expect(prompt).toContain('openai/gpt-4o');
		expect(prompt).toContain('<env>');
	});
});

describe('composeContext environment and references', () => {
	it('includes deterministic environment with model/provider', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const result = composeContext({
			cwd,
			model: 'claude-sonnet-4-20250514',
			provider: 'anthropic',
			sessionStartedAt: SESSION_STARTED,
			now: NOW,
		});

		expect(result.systemPrompt).toContain('claude-sonnet-4-20250514');
		expect(result.systemPrompt).toContain('anthropic/claude-sonnet-4-20250514');
		expect(result.systemPrompt).toContain(SESSION_STARTED.toISOString());
		expect(result.systemPrompt).toContain('<env>');
	});

	it('includes references when provided', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const refDir = join(tempDir, 'ref');
		mkdirSync(refDir, { recursive: true });
		writeFileSync(join(refDir, 'notes.txt'), 'reference notes');

		const result = composeContext({
			cwd,
			references: [{ name: 'my-ref', path: refDir, description: 'Test reference' }],
		});

		expect(result.systemPrompt).toContain('<available-references>');
		expect(result.systemPrompt).toContain('my-ref');
		expect(result.systemPrompt).toContain(refDir);
		expect(result.diagnostics).toHaveLength(0);
	});

	it('resolves relative reference directories against the working directory', () => {
		const cwd = join(tempDir, 'repo');
		const reference = join(cwd, '..', 'reference-project');
		mkdirSync(reference, { recursive: true });
		const result = composeContext({ cwd, references: [{ name: 'relative', path: '../reference-project' }] });

		expect(result.systemPrompt).toContain(reference);
		expect(result.diagnostics).toHaveLength(0);
	});

	it('omits disabled and non-directory references', () => {
		const cwd = join(tempDir, 'repo');
		mkdirSync(cwd, { recursive: true });
		const filePath = join(cwd, 'not-a-project.txt');
		writeFileSync(filePath, 'not a directory');
		const result = composeContext({ cwd, references: [
			{ name: 'disabled', path: cwd, enabled: false },
			{ name: 'file', path: filePath },
		] });

		expect(result.systemPrompt).not.toContain('<name>disabled</name>');
		expect(result.systemPrompt).not.toContain('<name>file</name>');
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: 'Project reference is not a directory: file' }));
	});

	it('reports missing references in diagnostics', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);

		const result = composeContext({
			cwd,
			references: [{ name: 'missing-ref', path: '/nonexistent/path' }],
		});

		expect(result.systemPrompt).not.toContain('missing-ref');
		expect(result.diagnostics.some((d) => d.message.includes('does not exist'))).toBe(true);
	});

	it('stable system prompt contains project instructions, not agent prompt or memory', () => {
		const cwd = join(tempDir, 'repo');
		writeInstruction(cwd);
		const result = composeContext({ cwd });

		expect(result.systemPrompt).toContain('Project instruction from AGENTS.');
		expect(result.systemPrompt).not.toContain('Runtime knowledge policy');
		expect(result.systemPrompt).not.toContain('<memory>');
	});

	it('deterministic date from now parameter', () => {
		const cwd = join(tempDir, 'repo');
		const result = composeContext({
			cwd,
			model: 'gpt-4o',
			provider: 'openai',
			now: NOW,
		});

		expect(result.systemPrompt).toContain('2026-07-16');
	});
});
