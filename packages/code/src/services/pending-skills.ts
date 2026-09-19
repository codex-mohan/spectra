export interface PendingSkill {
	id: string;
	name: string;
	description: string;
	whenToUse: string;
	content: string;
	action: 'create' | 'evolve';
	existingSkillId?: string;
	reason: string;
	createdAt: string;
}

export type PendingSkillEnqueueResult = 'added' | 'updated' | 'unchanged';

const pending = new Map<string, PendingSkill>();

function identity(skill: Pick<PendingSkill, 'id' | 'action' | 'existingSkillId'>): string {
	return skill.action === 'evolve' ? skill.existingSkillId ?? skill.id : skill.id;
}

function sameProposal(left: PendingSkill, right: PendingSkill): boolean {
	return left.action === right.action
		&& left.existingSkillId === right.existingSkillId
		&& left.name === right.name
		&& left.description === right.description
		&& left.whenToUse === right.whenToUse
		&& left.content === right.content
		&& left.reason === right.reason;
}

export function enqueuePendingSkill(skill: PendingSkill): PendingSkillEnqueueResult {
	const key = identity(skill);
	const existing = pending.get(key);
	if (existing && sameProposal(existing, skill)) return 'unchanged';
	pending.set(key, existing ? { ...skill, createdAt: existing.createdAt } : skill);
	return existing ? 'updated' : 'added';
}

export function getPendingSkills(): PendingSkill[] {
	return [...pending.values()];
}

export function approvePendingSkill(id: string): PendingSkill | undefined {
	for (const [key, skill] of pending) {
		if (skill.id !== id && key !== id) continue;
		pending.delete(key);
		return skill;
	}
	return undefined;
}

export function rejectPendingSkill(id: string): boolean {
	for (const [key, skill] of pending) {
		if (skill.id !== id && key !== id) continue;
		pending.delete(key);
		return true;
	}
	return false;
}

export function clearPendingSkills(): void {
	pending.clear();
}
