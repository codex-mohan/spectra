import { beforeEach, describe, expect, it } from 'vitest';
import {
	approvePendingSkill,
	clearPendingSkills,
	enqueuePendingSkill,
	getPendingSkills,
	rejectPendingSkill,
	type PendingSkill,
} from '../services/pending-skills.js';

function proposal(overrides: Partial<PendingSkill> = {}): PendingSkill {
	return {
		id: 'search-windows-drive',
		name: 'Search Windows Drive',
		description: 'Search a Windows drive with a specialized filesystem tool.',
		whenToUse: 'When a broad Windows filesystem search is required.',
		content: '# Search Windows Drive\n\n## Steps\n1. Search.\n2. Verify.',
		action: 'create',
		reason: 'Repeated workflow | Verified result',
		createdAt: '2026-01-01T00:00:00.000Z',
		...overrides,
	};
}

describe('pending skills', () => {
	beforeEach(() => clearPendingSkills());

	it('upserts repeated proposals with the same stable identity', () => {
		expect(enqueuePendingSkill(proposal())).toBe('added');
		expect(enqueuePendingSkill(proposal({ description: 'Updated reusable procedure.' }))).toBe('updated');

		expect(getPendingSkills()).toHaveLength(1);
		expect(getPendingSkills()[0].description).toBe('Updated reusable procedure.');
		expect(getPendingSkills()[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
	});

	it('deduplicates evolutions by their existing stored skill id', () => {
		enqueuePendingSkill(proposal({ id: 'first-name', action: 'evolve', existingSkillId: 'stored-skill' }));
		enqueuePendingSkill(proposal({ id: 'renamed', name: 'Renamed Skill', action: 'evolve', existingSkillId: 'stored-skill' }));

		expect(getPendingSkills()).toHaveLength(1);
		expect(getPendingSkills()[0].name).toBe('Renamed Skill');
	});

	it('makes rejection and approval idempotent', () => {
		enqueuePendingSkill(proposal());
		expect(rejectPendingSkill('search-windows-drive')).toBe(true);
		expect(rejectPendingSkill('search-windows-drive')).toBe(false);

		enqueuePendingSkill(proposal());
		expect(approvePendingSkill('search-windows-drive')?.name).toBe('Search Windows Drive');
		expect(approvePendingSkill('search-windows-drive')).toBeUndefined();
		expect(getPendingSkills()).toEqual([]);
	});
});
