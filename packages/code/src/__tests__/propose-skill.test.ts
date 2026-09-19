import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { proposeSkillTool } from '../tools/propose-skill.js';
import { spectraToolToAgentTool } from '../tools/index.js';
import { clearPendingSkills, getPendingSkills } from '../services/pending-skills.js';
import { invalidateSkillCatalog } from '../services/skill-catalog.js';
import { saveEvolvingSkill } from '../services/skill-store.js';

const content = `# Diagnose Repeatable Fetch Failures

## Steps
1. Reproduce the request with captured inputs.
2. Compare the provider response and local transport logs.

## Verification
Confirm the same request succeeds after the correction.

## Pitfalls
Do not treat temporary provider outages as implementation failures.`;

function validArgs(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		action: 'create',
		name: 'Diagnose Fetch Failures',
		description: 'Diagnose repeatable provider fetch failures using captured evidence.',
		whenToUse: 'When a provider request fails consistently and needs systematic diagnosis.',
		content,
		evidence: ['The same failure reproduced with identical request inputs.', 'Transport logs identified a stable correction that was verified.'],
		...overrides,
	};
}

describe('propose_skill tool', () => {
	let home: string;
	let originalHome: string | undefined;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), 'spectra-propose-skill-'));
		originalHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = home;
		clearPendingSkills();
		invalidateSkillCatalog();
	});

	afterEach(() => {
		clearPendingSkills();
		invalidateSkillCatalog();
		if (originalHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = originalHome;
		rmSync(home, { recursive: true, force: true });
	});

	it('requires concrete reusable-workflow evidence', () => {
		const tool = spectraToolToAgentTool(proposeSkillTool);
		expect(() => tool.prepareArguments?.(validArgs({ evidence: ['Only one observation.'] }))).toThrow('Invalid arguments');
	});

	it('adds one reviewable proposal and updates repeated identities', async () => {
		const first = await proposeSkillTool.execute(validArgs() as never, { toolCallId: 'one' });
		const second = await proposeSkillTool.execute(validArgs({ description: 'Updated description for the same workflow.' }) as never, { toolCallId: 'two' });

		expect(first.isError).not.toBe(true);
		expect(second.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Updated pending') });
		expect(getPendingSkills()).toHaveLength(1);
		expect(getPendingSkills()[0].description).toBe('Updated description for the same workflow.');
	});

	it('rejects create proposals that collide with a saved skill', async () => {
		const now = new Date().toISOString();
		await saveEvolvingSkill({
			id: 'diagnose-fetch-failures',
			name: 'Diagnose Fetch Failures',
			description: 'Existing procedure',
			whenToUse: 'When fetch failures repeat',
			tags: [],
			useCount: 0,
			version: 1,
			createdAt: now,
			updatedAt: now,
			origin: 'learned',
		}, '# Existing procedure');
		invalidateSkillCatalog();

		const result = await proposeSkillTool.execute(validArgs() as never, { toolCallId: 'collision' });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('Propose an evolve action') });
		expect(getPendingSkills()).toEqual([]);
	});
});
