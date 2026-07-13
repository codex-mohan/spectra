import type { AgentTool } from '@mohanscodex/spectra-agent';
import {
	getAgentDefinition,
	getBuiltinCatalog,
	getCachedCatalog,
	loadAgentCatalog,
	invalidateAgentCatalog,
} from './catalog.js';
import { filterToolsByDefinition } from './tool-filter.js';
import type { AgentCatalog, AgentDefinition } from './types.js';

export type {
	AgentDefinition,
	AgentCatalog,
	AgentDiagnostic,
	AgentMode,
	AgentThinkingLevel,
	AgentOutputSchema,
} from './types.js';
export {
	loadAgentCatalog,
	getCachedCatalog,
	getBuiltinCatalog,
	getAgentDefinition,
	invalidateAgentCatalog,
};
export { filterToolsByDefinition, normalizeToolName } from './tool-filter.js';
export { BUILTIN_AGENT_DEFINITIONS } from './definitions/index.js';

export function getPrimaryAgents(catalog?: AgentCatalog): string[] {
	return (catalog ?? getCachedCatalog()).primary;
}

export function getSubagents(catalog?: AgentCatalog): string[] {
	return (catalog ?? getCachedCatalog()).subagents;
}

export function filterToolsByAgent(
	allTools: AgentTool[],
	agentName: string,
	catalog?: AgentCatalog,
): AgentTool[] {
	const def = getAgentDefinition(agentName, catalog);
	return filterToolsByDefinition(allTools, def);
}

/** Resolve definition from catalog (cached after loadAgentCatalog). */
export function resolveAgentDefinition(
	name: string,
	catalog?: AgentCatalog,
): AgentDefinition | undefined {
	return getAgentDefinition(name, catalog);
}
