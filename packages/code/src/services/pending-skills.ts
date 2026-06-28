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

const pending: PendingSkill[] = [];

export function enqueuePendingSkill(skill: PendingSkill): void {
	pending.push(skill);
}

export function getPendingSkills(): PendingSkill[] {
	return [...pending];
}

export function approvePendingSkill(id: string): PendingSkill | undefined {
	const idx = pending.findIndex((s) => s.id === id);
	if (idx === -1) return undefined;
	const [skill] = pending.splice(idx, 1);
	return skill;
}

export function rejectPendingSkill(id: string): boolean {
	const idx = pending.findIndex((s) => s.id === id);
	if (idx === -1) return false;
	pending.splice(idx, 1);
	return true;
}

export function clearPendingSkills(): void {
	pending.length = 0;
}
