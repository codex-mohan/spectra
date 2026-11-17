import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../agents/index.js';
import { reloadRuntime } from '../runtime/reload.js';
import { runtimeRegistry } from '../runtime/registry.js';

let dir: string;
let previousCwd: string;

function writeAgent(name: string, prompt: string): void {
	const agents = join(dir, '.spectra', 'agents');
	mkdirSync(agents, { recursive: true });
	writeFileSync(join(agents, `${name}.md`), `---\nname: ${name}\ndescription: reload fixture\nmode: primary\n---\n\n${prompt}\n`, 'utf8');
}

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'spectra-reload-'));
	previousCwd = process.cwd();
});

afterEach(() => {
	process.chdir(previousCwd);
	rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe('runtime reload', () => {
	it('emits a revision and the changed domains', async () => {
		const changes: Array<{ revision: number; domains: string[] }> = [];
		const unsubscribe = runtimeRegistry.subscribe((change) => changes.push(change));
		await reloadRuntime(['commands'], dir);
		unsubscribe();
		expect(changes).toHaveLength(1);
		expect(changes[0].domains).toEqual(['commands']);
		expect(changes[0].revision).toBeGreaterThan(0);
	});

	it('invalidates the agent catalog for the reloaded workspace', async () => {
		writeAgent('reload-fixture', 'first prompt');
		const before = await loadAgentCatalog(dir);
		expect(before.definitions['reload-fixture']?.prompt).toContain('first prompt');
		writeAgent('reload-fixture', 'second prompt');
		const result = await reloadRuntime(['agents'], dir);
		expect(result.errors).toEqual([]);
		const after = await loadAgentCatalog(dir);
		expect(after.definitions['reload-fixture']?.prompt).toContain('second prompt');
	});
});
