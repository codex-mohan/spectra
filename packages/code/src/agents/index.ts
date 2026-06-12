import type { AgentTool } from '@mohanscodex/spectra-agent';
import type { AgentDefinition } from './types.js';
import { AGENT_DEFINITIONS, PRIMARY_AGENTS, SUBAGENTS } from './definitions/index.js';

export type { AgentDefinition } from './types.js';
export { AGENT_DEFINITIONS, PRIMARY_AGENTS, SUBAGENTS };

export function filterToolsByAgent(allTools: AgentTool[], agentName: string): AgentTool[] {
	const def = AGENT_DEFINITIONS[agentName];
	if (!def) return allTools;
	const blocked = new Set(def.blockedTools);
	return allTools.filter((t) => !blocked.has(t.name));
}
