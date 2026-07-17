import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	composeContext,
	loadContext,
} from '../services/context.js';

let tempDir: string;
let previousSpectraHome: string | undefined;

function writeFile(path: string, content: string): void {
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, content);
}

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), 'spectra-context-'));
	previousSpectraHome = process.env.SPECTRA_HOME;
	process.env.SPECTRA_HOME = join(tempDir, 'home', '.spectra');
});

afterEach(() => {
	if (previousSpectraHome === undefined) delete process.env.SPECTRA_HOME;
	else process.env.SPECTRA_HOME = previousSpectraHome;
	rmSync(tempDir, { recursive: true, force: true });
});

describe('context composer', () => {
	it('orders ancestor instructions from general to specific and source-tags each verbatim body', () => {
		const root = join(tempDir, 'repo');
		const nested = join(root, 'packages', 'api');
		const rootBody = '# Root\n\n    preserved indentation\n';
		const nestedBody = '```ts\nconst packageRule = true;\n```\n';
		writeFile(join(root, 'AGENTS.md'), rootBody);
		writeFile(join(nested, 'CLAUDE.md'), nestedBody);

		const result = composeContext({ cwd: nested });
		const rootIndex = result.systemPrompt.indexOf(rootBody);
		const nestedIndex = result.systemPrompt.indexOf(nestedBody);

		expect(rootIndex).toBeGreaterThan(-1);
		expect(nestedIndex).toBeGreaterThan(rootIndex);
		expect(result.sources.find((source) => source.path === join(root, 'AGENTS.md'))?.content).toBe(rootBody);
		expect(result.systemPrompt).toContain(`<context-file path="${join(root, 'AGENTS.md')}"`);
	});

	it('retains only the closest exact expanded-content source', () => {
		const root = join(tempDir, 'repo');
		const nested = join(root, 'packages', 'api');
		const duplicate = 'Use the shared contract exactly.\n';
		writeFile(join(root, 'AGENTS.md'), duplicate);
		writeFile(join(nested, 'CLAUDE.md'), duplicate);

		const result = composeContext({ cwd: nested });
		expect(result.sources.map((source) => source.path)).toContain(join(nested, 'CLAUDE.md'));
		expect(result.sources.map((source) => source.path)).not.toContain(join(root, 'AGENTS.md'));
		expect(result.instructions.filter((content) => content === duplicate)).toHaveLength(1);
	});

	it('uses native Spectra source precedence for exact duplicates at one scope', () => {
		const root = join(tempDir, 'repo');
		const duplicate = 'Prefer the native source.\n';
		writeFile(join(root, 'AGENTS.md'), duplicate);
		writeFile(join(root, 'SPECTRA.md'), duplicate);

		const result = composeContext({ cwd: root });

		expect(result.sources.map((source) => source.path)).toContain(join(root, 'SPECTRA.md'));
		expect(result.sources.map((source) => source.path)).not.toContain(join(root, 'AGENTS.md'));
	});


	it('retains similar but non-identical instruction files', () => {
		const root = join(tempDir, 'repo');
		const nested = join(root, 'packages', 'api');
		writeFile(join(root, 'AGENTS.md'), 'Use the shared contract.\n');
		writeFile(join(nested, 'CLAUDE.md'), 'Use the shared contract carefully.\n');

		const result = composeContext({ cwd: nested });

		expect(result.sources.map((source) => source.path)).toEqual(expect.arrayContaining([
			join(root, 'AGENTS.md'),
			join(nested, 'CLAUDE.md'),
		]));
	});
	it('expands relative imports, preserves the imported body, and reports cycles', () => {
		const root = join(tempDir, 'repo');
		const importedBody = '## Shared\n\nUse exact output.\n';
		writeFile(join(root, 'AGENTS.md'), `# Root\n\n@shared.md\n`);
		writeFile(join(root, 'shared.md'), importedBody);

		const expanded = composeContext({ cwd: root });
		expect(expanded.sources.find((source) => source.path === join(root, 'AGENTS.md'))?.content).toBe(`# Root\n\n${importedBody}\n`);

		writeFile(join(root, 'shared.md'), '@AGENTS.md\n');
		const cyclic = composeContext({ cwd: root });
		expect(cyclic.diagnostics.some((diagnostic) => diagnostic.message.includes('cycle detected'))).toBe(true);
	});

	it('uses a deterministic fingerprint that changes with stable instruction content', () => {
		const root = join(tempDir, 'repo');
		const instructionPath = join(root, 'AGENTS.md');
		writeFile(instructionPath, 'first\n');
		const first = composeContext({ cwd: root });
		const same = composeContext({ cwd: root });
		writeFile(instructionPath, 'second\n');
		const second = composeContext({ cwd: root });

		expect(same.fingerprint).toBe(first.fingerprint);
		expect(second.fingerprint).not.toBe(first.fingerprint);
	});

	it('omits oversized instruction files with a diagnostic', () => {
		const root = join(tempDir, 'repo');
		writeFile(join(root, 'AGENTS.md'), 'x'.repeat(20));

		const result = composeContext({ cwd: root, maxFileChars: 10 });

		expect(result.sources).toHaveLength(0);
		expect(result.diagnostics).toContainEqual(expect.objectContaining({ message: 'Instruction file exceeds 10 characters' }));
	});
});
