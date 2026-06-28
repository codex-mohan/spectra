import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	saveEvolvingSkill,
	loadEvolvingSkill,
	incrementUseCount,
	loadAllEvolvingSkills,
	evolveSkill,
} from '../services/skill-store.js';
import { parseSkillSynthesisDecision } from '../services/skill-synth.js';

describe('Code evolving skill store', () => {
	let tmpDir: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-evolve-'));
		originalHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = tmpDir;
	});

	afterEach(() => {
		if (originalHome !== undefined) {
			process.env.SPECTRA_HOME = originalHome;
		} else {
			delete process.env.SPECTRA_HOME;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('saves and loads an evolving skill', async () => {
		await saveEvolvingSkill({
			id: 'test-skill',
			name: 'Test Skill',
			description: 'A test skill',
			whenToUse: 'when testing',
			tags: ['test'],
			useCount: 0,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned',
		}, '---\nname: Test Skill\n---\n\n# Test');

		const loaded = await loadEvolvingSkill('test-skill');
		expect(loaded).not.toBeNull();
		expect(loaded?.meta.name).toBe('Test Skill');
		expect(loaded?.meta.useCount).toBe(0);
		expect(loaded?.content).toContain('# Test');
	});

	it('increments useCount by stored id', async () => {
		await saveEvolvingSkill({
			id: 'count-test',
			name: 'Count Test',
			description: 'Test',
			whenToUse: '',
			tags: [],
			useCount: 0,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned',
		}, '# Test');

		await incrementUseCount('count-test');
		await incrementUseCount('count-test');

		const loaded = await loadEvolvingSkill('count-test');
		expect(loaded?.meta.useCount).toBe(2);
	});

	it('loads all evolving skills with their stored ids', async () => {
		for (let i = 0; i < 3; i++) {
			await saveEvolvingSkill({
				id: `skill-${i}`,
				name: `Skill ${i}`,
				description: `Skill number ${i}`,
				whenToUse: '',
				tags: [],
				useCount: 0,
				version: 1,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				origin: 'learned',
			}, `# Skill ${i}`);
		}

		const all = await loadAllEvolvingSkills();
		expect(all.map((skill) => skill.evolvingSkillId).sort()).toEqual(['skill-0', 'skill-1', 'skill-2']);
	});

	it('evolves a skill without losing use count', async () => {
		await saveEvolvingSkill({
			id: 'evolve-test',
			name: 'Evolve Test',
			description: 'Original',
			whenToUse: '',
			tags: [],
			useCount: 5,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned',
		}, '# Original');

		await evolveSkill('evolve-test', { description: 'Updated' }, '# Updated');

		const loaded = await loadEvolvingSkill('evolve-test');
		expect(loaded?.meta.version).toBe(2);
		expect(loaded?.meta.description).toBe('Updated');
		expect(loaded?.meta.origin).toBe('evolved');
		expect(loaded?.meta.useCount).toBe(5);
	});

	it('parses LLM evolve decisions by stored id instead of display name', async () => {
		await saveEvolvingSkill({
			id: 'debug-fetch-errors',
			name: 'Debug Fetch Errors',
			description: 'Original',
			whenToUse: 'when debugging fetch errors',
			tags: [],
			useCount: 0,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned',
		}, '# Original');

		const decision = parseSkillSynthesisDecision(JSON.stringify({
			action: 'evolve',
			existingSkillId: 'debug-fetch-errors',
			name: 'Debug Fetch Errors',
			description: 'Updated',
			whenToUse: 'when debugging fetch errors',
			content: '# Updated',
			reason: 'The session improves the existing workflow.',
		}), await loadAllEvolvingSkills());

		expect(decision).toEqual({
			action: 'evolve',
			existingSkillId: 'debug-fetch-errors',
			name: 'Debug Fetch Errors',
			description: 'Updated',
			whenToUse: 'when debugging fetch errors',
			content: '# Updated',
			reason: 'The session improves the existing workflow.',
		});
	});

	it('returns null for non-existent skills', async () => {
		const loaded = await loadEvolvingSkill('does-not-exist');
		expect(loaded).toBeNull();
	});
});

