import type { Message } from '@mohanscodex/spectra-ai';
import type { Skill } from './skill.js';
import type { EvolvingSkillMeta } from './skill-store.js';
import { saveEvolvingSkill, findSimilarSkill, evolveSkill, loadAllEvolvingSkills } from './skill-store.js';

export interface SessionTrace {
	messages: Message[];
	toolCalls: { name: string; args: unknown; success: boolean }[];
	duration: number;
}

const MIN_TOOL_CALLS = 3;
const MIN_MESSAGES = 6;
const SIMILARITY_THRESHOLD = 0.3;

export function isSessionEligibleForSynthesis(trace: SessionTrace): boolean {
	return trace.toolCalls.length >= MIN_TOOL_CALLS && trace.messages.length >= MIN_MESSAGES;
}

function extractSessionSummary(trace: SessionTrace): string {
	const parts: string[] = [];

	const userMsgs = trace.messages.filter((m) => m.role === 'user');
	if (userMsgs.length > 0) {
		const content = userMsgs[0].content;
		const text = typeof content === 'string'
			? content
			: content.filter((c) => c.type === 'text').map((c) => (c as { type: 'text'; text: string }).text).join(' ');
		parts.push(`User intent: ${text}`);
	}

	const toolSummary = trace.toolCalls.map((t) => `${t.name}(${t.success ? 'ok' : 'fail'})`).join(', ');
	parts.push(`Tools used: ${toolSummary}`);

	const failedTools = trace.toolCalls.filter((t) => !t.success);
	if (failedTools.length > 0) {
		parts.push(`Failures: ${failedTools.map((t) => t.name).join(', ')}`);
	}

	return parts.join('\n');
}

function extractProcedure(trace: SessionTrace): string {
	const steps: string[] = [];
	let stepNum = 1;

	for (const call of trace.toolCalls) {
		if (call.name === 'bash' || call.name === 'shell') {
			const cmd = typeof call.args === 'object' && call.args !== null
				? (call.args as Record<string, unknown>).command || (call.args as Record<string, unknown>).cmd
				: call.args;
			steps.push(`${stepNum}. Run \`${cmd}\``);
			stepNum++;
		} else if (call.name === 'read') {
			const filePath = typeof call.args === 'object' && call.args !== null
				? (call.args as Record<string, unknown>).path || (call.args as Record<string, unknown>).filePath
				: call.args;
			steps.push(`${stepNum}. Read \`${filePath}\``);
			stepNum++;
		} else if (call.name === 'write' || call.name === 'edit') {
			const filePath = typeof call.args === 'object' && call.args !== null
				? (call.args as Record<string, unknown>).path || (call.args as Record<string, unknown>).filePath
				: call.args;
			steps.push(`${stepNum}. Modify \`${filePath}\``);
			stepNum++;
		}
	}

	return steps.join('\n');
}

function extractPitfalls(trace: SessionTrace): string {
	const pitfalls: string[] = [];
	const failedTools = trace.toolCalls.filter((t) => !t.success);

	if (failedTools.length > 0) {
		for (const fail of failedTools) {
			pitfalls.push(`- ${fail.name} may fail with certain inputs — verify before relying on it`);
		}
	}

	return pitfalls.join('\n');
}

function toKebabCase(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, 80);
}

export function generateSkillContent(trace: SessionTrace): {
	id: string;
	name: string;
	description: string;
	whenToUse: string;
	content: string;
} {
	const summary = extractSessionSummary(trace);
	const userMsgs = trace.messages.filter((m) => m.role === 'user');
	const rawContent = userMsgs[0]?.content || 'Unknown task';
	const firstUserMsg = typeof rawContent === 'string'
		? rawContent
		: rawContent.filter((c) => c.type === 'text').map((c) => (c as { type: 'text'; text: string }).text).join(' ');

	const name = firstUserMsg.length > 60
		? firstUserMsg.slice(0, 57).trim()
		: firstUserMsg;

	const id = toKebabCase(name) || `skill-${Date.now()}`;
	const description = `Auto-generated from session: ${firstUserMsg.slice(0, 100)}`;
	const whenToUse = `when the user needs to ${firstUserMsg.toLowerCase().slice(0, 100)}`;

	const procedure = extractProcedure(trace);
	const pitfalls = extractPitfalls(trace);

	const content = `---
name: ${name}
description: ${description}
when_to_use: ${whenToUse}
---

# ${name}

## Context
${summary}

## Steps
${procedure || '1. Analyze the task requirements\n2. Implement the solution\n3. Verify the result'}

${pitfalls ? `## Pitfalls\n${pitfalls}` : ''}
`;

	return { id, name, description, whenToUse, content };
}

export async function synthesizeSkill(
	trace: SessionTrace,
	existingSkills: Skill[],
): Promise<{ id: string; action: 'created' | 'evolved' | 'skipped' } | null> {
	if (!isSessionEligibleForSynthesis(trace)) return null;

	const { id, name, description, whenToUse, content } = generateSkillContent(trace);

	const similar = await findSimilarSkill(name, description, whenToUse, existingSkills);
	if (similar) {
		await evolveSkill(similar.name, { description, whenToUse }, content);
		return { id: similar.name, action: 'evolved' };
	}

	const meta: EvolvingSkillMeta = {
		id,
		name,
		description,
		whenToUse,
		tags: [],
		useCount: 0,
		version: 1,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		origin: 'learned',
	};

	await saveEvolvingSkill(meta, content);
	return { id, action: 'created' };
}
