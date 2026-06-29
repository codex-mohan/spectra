import { stream } from '@mohanscodex/spectra-ai';
import type { Message } from '@mohanscodex/spectra-ai';
import type { Skill } from '@mohanscodex/spectra-agent';
import { AGENT_DEFINITIONS } from '../agents/index.js';

export interface SessionTrace {
	messages: Message[];
	toolCalls: { name: string; args: unknown; success: boolean }[];
	duration: number;
}

export interface SkillSynthesisCandidate {
	action: 'create' | 'evolve';
	existingSkillId?: string;
	name: string;
	description: string;
	whenToUse: string;
	content: string;
	reason: string;
}

export interface SkillSynthesisOptions {
	model: string | null | undefined;
	provider: string | null | undefined;
	getApiKey: (provider: string) => string | undefined;
}

interface RawSkillSynthesisDecision {
	action?: unknown;
	existingSkillId?: unknown;
	name?: unknown;
	description?: unknown;
	whenToUse?: unknown;
	content?: unknown;
	reason?: unknown;
}

export async function synthesizeSkillWithAgent(
	trace: SessionTrace,
	existingSkills: Skill[],
	options: SkillSynthesisOptions,
): Promise<SkillSynthesisCandidate | null> {
	const def = AGENT_DEFINITIONS['skill-synth'];
	let modelId = def?.model?.id ?? options.model;
	let provider = def?.model?.provider ?? options.provider;
	if (!modelId || !provider) return null;

	let apiKey = options.getApiKey(provider);
	if (!apiKey && def?.model?.provider) {
		modelId = options.model;
		provider = options.provider;
		if (!modelId || !provider) return null;
		apiKey = options.getApiKey(provider);
	}
	if (!apiKey) return null;

	const prompt = buildSkillSynthesisPrompt(def?.prompt ?? '', trace, existingSkills);
	let text = '';
	const model = { id: modelId, name: modelId, provider, api: provider };
	const context = { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] };
	const events = stream(model, context, { apiKey });

	for await (const event of events) {
		if (event.type === 'text_delta' && event.delta) {
			text += event.delta;
		}
	}

	return parseSkillSynthesisDecision(text, existingSkills);
}

export function parseSkillSynthesisDecision(text: string, existingSkills: Skill[]): SkillSynthesisCandidate | null {
	const parsed = parseJsonObject(text);
	if (!parsed) return null;
	return normalizeSkillSynthesisDecision(parsed, existingSkills);
}

function normalizeSkillSynthesisDecision(
	decision: RawSkillSynthesisDecision,
	existingSkills: Skill[],
): SkillSynthesisCandidate | null {
	if (decision.action === 'skip') return null;
	if (decision.action !== 'create' && decision.action !== 'evolve') return null;

	const name = readNonEmptyString(decision.name);
	const description = readNonEmptyString(decision.description);
	const whenToUse = readNonEmptyString(decision.whenToUse);
	const content = readNonEmptyString(decision.content);
	const reason = readNonEmptyString(decision.reason) ?? 'LLM judged the session contains a reusable procedure.';
	if (!name || !description || !whenToUse || !content) return null;

	if (decision.action === 'evolve') {
		const existingSkillId = readNonEmptyString(decision.existingSkillId);
		if (!existingSkillId || !existingSkills.some((skill) => getSkillIdentity(skill) === existingSkillId)) return null;
		return { action: 'evolve', existingSkillId, name, description, whenToUse, content, reason };
	}

	return { action: 'create', name, description, whenToUse, content, reason };
}

function buildSkillSynthesisPrompt(agentPrompt: string, trace: SessionTrace, existingSkills: Skill[]): string {
	return `You are evaluating whether a coding session contains a reusable procedure that should become or evolve a skill.

## Runtime knowledge policy
- Memory stores durable facts only: user preferences, project facts, decisions, constraints, reminders.
- Skills store reusable procedures only: trigger conditions, steps, verification, pitfalls.
- Do not create skills from facts, preferences, one-off commands, transient debugging, or raw transcripts.
- Create when the session taught a reusable workflow not covered by existing skills.
- Evolve when the session improves an existing reusable workflow; use the exact stored skill id.
- Prefer skip when confidence is low.

${agentPrompt}

<existing_skills>
${formatExistingSkills(existingSkills)}
</existing_skills>

<session_trace>
${formatTrace(trace)}
</session_trace>

Return the JSON decision now.`;
}

function formatExistingSkills(skills: Skill[]): string {
	if (skills.length === 0) return 'none';
	return skills.map((skill) => {
		const id = getSkillIdentity(skill);
		return `- id: ${id}\n  name: ${skill.name}\n  description: ${skill.description ?? ''}\n  whenToUse: ${skill.whenToUse ?? ''}`;
	}).join('\n');
}

function getSkillIdentity(skill: Skill): string {
	if ('evolvingSkillId' in skill && typeof skill.evolvingSkillId === 'string') return skill.evolvingSkillId;
	return skill.name;
}

function formatTrace(trace: SessionTrace): string {
	return JSON.stringify({
		messages: trace.messages.map(formatMessage),
		toolCalls: trace.toolCalls,
		duration: trace.duration,
	}, null, 2);
}

function formatMessage(message: Message): unknown {
	if (message.role === 'user') {
		return { role: message.role, content: message.content };
	}
	if (message.role === 'assistant') {
		return { role: message.role, content: message.content, stopReason: message.stopReason };
	}
	return {
		role: message.role,
		toolName: message.toolName,
		isError: message.isError,
		content: message.content,
		details: message.details,
	};
}

function parseJsonObject(text: string): RawSkillSynthesisDecision | null {
	const trimmed = text.trim();
	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
	const candidate = fenced?.[1] ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1);
	if (!candidate) return null;

	try {
		const value: unknown = JSON.parse(candidate);
		if (!isRecord(value)) return null;
		return value;
	} catch {
		return null;
	}
}

function readNonEmptyString(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
