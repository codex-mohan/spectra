import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { enqueuePendingSkill, getPendingSkills } from '../services/pending-skills.js';
import {
	loadAllEvolvingSkills,
	normalizeSkillId,
} from '../services/skill-store.js';
import { loadAllSkills } from '../services/skill-catalog.js';

const proposalParameters = z.object({
	action: z.enum(['create', 'evolve']).describe('Create a new reusable skill or evolve an existing learned skill'),
	name: z.string().min(3).max(80).describe('Short human-readable skill name'),
	description: z.string().min(12).max(240).describe('One sentence describing what the skill does'),
	whenToUse: z.string().min(12).max(400).describe('Concrete trigger conditions for loading the skill'),
	content: z.string().min(120).describe('Instruction-quality Markdown with steps, verification, and pitfalls'),
	evidence: z.array(z.string().min(8).max(300)).min(2).max(5).describe('At least two concrete observations from the completed work showing this procedure is reusable'),
	existingSkillId: z.string().optional().describe('Required for evolve; use the stored evolving skill id'),
});

function canonicalContent(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export const proposeSkillTool: SpectraTool<typeof proposalParameters> = {
	name: 'propose_skill',
	displayName: 'Propose skill',
	capabilities: { reads: false, writes: false },
	description: `Propose a reusable procedural skill for user review.
Use this only after completing work that demonstrated a repeatable, multi-step workflow with concrete verification and pitfalls. Do not use it for ordinary implementation, a one-off command, project facts, user preferences, transient debugging, summaries, or anything already covered by a saved skill. Every proposal remains pending until the user approves it with /skills. Use action=evolve with the exact stored id when improving an existing learned skill.`,
	promptGuidelines: [
		'Call propose_skill only when the completed work produced a reusable procedure that will materially help future sessions.',
		'Never propose a skill merely because a task completed successfully or used several tools.',
	],
	parameters: proposalParameters,
	execute: async ({ action, name, description, whenToUse, content, evidence, existingSkillId }) => {
		const id = normalizeSkillId(name);
		if (!id || id.length < 2) return errorResult('The skill name does not produce a valid stable id.');

		const saved = await loadAllEvolvingSkills();
		if (action === 'evolve') {
			if (!existingSkillId) return errorResult('existingSkillId is required when action is evolve.');
			const existing = saved.find((skill) => skill.evolvingSkillId === existingSkillId);
			if (!existing) return errorResult(`Cannot evolve unknown learned skill: ${existingSkillId}`);
		} else {
			const catalog = [...(await loadAllSkills()).values()];
			const sameIdentity = catalog.find((skill) => normalizeSkillId(skill.name) === id);
			if (sameIdentity) {
				const learned = saved.find((skill) => skill.name === sameIdentity.name);
				return errorResult(learned
					? `A learned skill with this identity already exists: ${learned.name} (${learned.evolvingSkillId}). Propose an evolve action instead.`
					: `A skill with this identity already exists: ${sameIdentity.name}. Load it instead of creating a duplicate.`);
			}
			const sameContent = catalog.find((skill) => canonicalContent(skill.content) === canonicalContent(content));
			if (sameContent) {
				return errorResult(`This procedure is already saved as ${sameContent.name}.`);
			}
		}

		const matchingPendingContent = getPendingSkills().find((skill) =>
			skill.id !== (action === 'evolve' ? existingSkillId : id)
			&& canonicalContent(skill.content) === canonicalContent(content),
		);
		if (matchingPendingContent) {
			return errorResult(`The same procedure is already pending as ${matchingPendingContent.name}.`);
		}

		const targetId = action === 'evolve' ? existingSkillId! : id;
		const result = enqueuePendingSkill({
			id: targetId,
			action,
			existingSkillId: action === 'evolve' ? existingSkillId : undefined,
			name: name.trim(),
			description: description.trim(),
			whenToUse: whenToUse.trim(),
			content: content.trim(),
			reason: evidence.map((item) => item.trim()).join(' | '),
			createdAt: new Date().toISOString(),
		});

		if (result === 'unchanged') return textResult(`The same proposal is already pending: ${name}.`);
		return textResult(`${result === 'updated' ? 'Updated' : 'Added'} pending ${action} proposal for ${name}. The user can review it with /skills.`);
	},
};
