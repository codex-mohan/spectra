import type { AgentTool } from '@mohanscodex/spectra-agent';
import type { AgentDefinition } from './types.js';

/** Map Claude TitleCase / aliases onto Spectra tool names. */
const TOOL_ALIASES: Record<string, string> = {
	read: 'read',
	write: 'write',
	edit: 'edit',
	bash: 'bash',
	shell: 'bash',
	grep: 'grep',
	glob: 'glob',
	find: 'glob',
	ls: 'read',
	webfetch: 'web_fetch',
	web_fetch: 'web_fetch',
	websearch: 'web_fetch',
	task: 'task',
	todo: 'todo',
	memory: 'memory',
	skill: 'skill',
	find_skills: 'find_skills',
	// Claude TitleCase
	Read: 'read',
	Write: 'write',
	Edit: 'edit',
	Bash: 'bash',
	Shell: 'bash',
	Grep: 'grep',
	Glob: 'glob',
	WebFetch: 'web_fetch',
	Task: 'task',
};

export function normalizeToolName(name: string): string {
	const trimmed = name.trim();
	if (!trimmed) return trimmed;
	if (TOOL_ALIASES[trimmed]) return TOOL_ALIASES[trimmed];
	const lower = trimmed.toLowerCase();
	if (TOOL_ALIASES[lower]) return TOOL_ALIASES[lower];
	return lower;
}

/**
 * Claude Code tool resolution:
 *   pool = tools present ? allowlist : allTools
 *   pool = pool − disallowedTools
 */
export function filterToolsByDefinition(allTools: AgentTool[], def: AgentDefinition | undefined): AgentTool[] {
	if (!def) return allTools;

	const deny = new Set((def.disallowedTools ?? []).map(normalizeToolName));

	let pool = allTools;
	if (def.tools && def.tools.length > 0) {
		const allow = new Set(def.tools.map(normalizeToolName));
		pool = allTools.filter((t) => allow.has(normalizeToolName(t.name)));
	}

	if (deny.size === 0) return pool;
	return pool.filter((t) => !deny.has(normalizeToolName(t.name)));
}
