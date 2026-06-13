import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Evolving skill store', () => {
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
		const { saveEvolvingSkill, loadEvolvingSkill } = await import('../skill-store.js');
		const meta = {
			id: 'test-skill',
			name: 'Test Skill',
			description: 'A test skill',
			whenToUse: 'when testing',
			tags: ['test'],
			useCount: 0,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned' as const,
		};

		await saveEvolvingSkill(meta, '---\nname: Test Skill\n---\n\n# Test');

		const loaded = await loadEvolvingSkill('test-skill');
		expect(loaded).not.toBeNull();
		expect(loaded!.meta.name).toBe('Test Skill');
		expect(loaded!.meta.useCount).toBe(0);
		expect(loaded!.content).toContain('# Test');
	});

	it('increments useCount', async () => {
		const { saveEvolvingSkill, loadEvolvingSkill, incrementUseCount } = await import('../skill-store.js');
		const meta = {
			id: 'count-test',
			name: 'Count Test',
			description: 'Test',
			whenToUse: '',
			tags: [],
			useCount: 0,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned' as const,
		};

		await saveEvolvingSkill(meta, '# Test');

		await incrementUseCount('count-test');
		await incrementUseCount('count-test');

		const loaded = await loadEvolvingSkill('count-test');
		expect(loaded!.meta.useCount).toBe(2);
	});

	it('loads all evolving skills', async () => {
		const { saveEvolvingSkill, loadAllEvolvingSkills } = await import('../skill-store.js');

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
				origin: 'learned' as const,
			}, `# Skill ${i}`);
		}

		const all = await loadAllEvolvingSkills();
		expect(all.length).toBe(3);
	});

	it('evolves a skill (version bump)', async () => {
		const { saveEvolvingSkill, loadEvolvingSkill, evolveSkill } = await import('../skill-store.js');
		const meta = {
			id: 'evolve-test',
			name: 'Evolve Test',
			description: 'Original',
			whenToUse: '',
			tags: [],
			useCount: 5,
			version: 1,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			origin: 'learned' as const,
		};

		await saveEvolvingSkill(meta, '# Original');

		await evolveSkill('evolve-test', { description: 'Updated' }, '# Updated');

		const loaded = await loadEvolvingSkill('evolve-test');
		expect(loaded!.meta.version).toBe(2);
		expect(loaded!.meta.description).toBe('Updated');
		expect(loaded!.meta.origin).toBe('evolved');
		expect(loaded!.meta.useCount).toBe(5); // preserved
	});

	it('returns null for non-existent skill', async () => {
		const { loadEvolvingSkill } = await import('../skill-store.js');
		const loaded = await loadEvolvingSkill('does-not-exist');
		expect(loaded).toBeNull();
	});
});

describe('Skill synthesis eligibility', () => {
	it('rejects sessions with too few tool calls', async () => {
		const { isSessionEligibleForSynthesis } = await import('../skill-synth.js');
		const trace = {
			messages: [
				{ role: 'user', content: 'Hello', timestamp: Date.now() },
				{ role: 'assistant', content: [{ type: 'text', text: 'Hi' }], timestamp: Date.now() },
			] as any[],
			toolCalls: [{ name: 'read', args: {}, success: true }],
			duration: 1000,
		};
		expect(isSessionEligibleForSynthesis(trace as any)).toBe(false);
	});

	it('rejects sessions with too few messages', async () => {
		const { isSessionEligibleForSynthesis } = await import('../skill-synth.js');
		const trace = {
			messages: [
				{ role: 'user', content: 'Hello', timestamp: Date.now() },
			] as any[],
			toolCalls: [
				{ name: 'read', args: {}, success: true },
				{ name: 'write', args: {}, success: true },
				{ name: 'bash', args: {}, success: true },
			],
			duration: 1000,
		};
		expect(isSessionEligibleForSynthesis(trace as any)).toBe(false);
	});

	it('accepts sessions with enough tool calls and messages', async () => {
		const { isSessionEligibleForSynthesis } = await import('../skill-synth.js');
		const trace = {
			messages: Array.from({ length: 8 }, (_, i) => ({
				role: i % 2 === 0 ? 'user' : 'assistant',
				content: i % 2 === 0 ? `Message ${i}` : [{ type: 'text', text: `Response ${i}` }],
				timestamp: Date.now(),
			})) as any[],
			toolCalls: [
				{ name: 'read', args: {}, success: true },
				{ name: 'write', args: {}, success: true },
				{ name: 'bash', args: {}, success: true },
			],
			duration: 5000,
		};
		expect(isSessionEligibleForSynthesis(trace as any)).toBe(true);
	});
});
