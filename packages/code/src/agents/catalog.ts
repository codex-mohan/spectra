import { BUILTIN_AGENT_DEFINITIONS } from './definitions/index.js';
import { loadDiscoveredAgents } from './loader.js';
import type { AgentCatalog, AgentDefinition, AgentDiagnostic } from './types.js';

let cached: AgentCatalog | null = null;
let cachedCwd: string | null = null;

function listPrimary(definitions: Record<string, AgentDefinition>): string[] {
	return Object.values(definitions)
		.filter((d) => (d.mode === 'primary' || d.mode === 'all') && !d.hidden)
		.map((d) => d.name)
		.sort((a, b) => a.localeCompare(b));
}

function listSubagents(definitions: Record<string, AgentDefinition>): string[] {
	return Object.values(definitions)
		.filter((d) => (d.mode === 'subagent' || d.mode === 'all') && !d.hidden)
		.map((d) => d.name)
		.sort((a, b) => a.localeCompare(b));
}

export function buildCatalogFromDefinitions(
	definitions: Record<string, AgentDefinition>,
	diagnostics: AgentDiagnostic[] = [],
): AgentCatalog {
	return {
		definitions,
		primary: listPrimary(definitions),
		subagents: listSubagents(definitions),
		diagnostics,
	};
}

/** Builtins only — sync fallback before async load completes. */
export function getBuiltinCatalog(): AgentCatalog {
	return buildCatalogFromDefinitions({ ...BUILTIN_AGENT_DEFINITIONS });
}

/**
 * Load full catalog: builtins merged with MD agents (MD overrides same name).
 */
export async function loadAgentCatalog(cwd: string = process.cwd()): Promise<AgentCatalog> {
	if (cached && cachedCwd === cwd) return cached;

	const definitions: Record<string, AgentDefinition> = { ...BUILTIN_AGENT_DEFINITIONS };
	const discovered = await loadDiscoveredAgents(cwd);
	for (const { definition } of discovered.agents) {
		const existing = definitions[definition.name];
		if (existing) {
			// MD overrides / patches builtin: keep builtin prompt only if MD body empty
			definitions[definition.name] = {
				...existing,
				...definition,
				prompt: definition.prompt.trim() ? definition.prompt : existing.prompt,
				// MD tools/disallowed fully replace when provided
				tools: definition.tools ?? existing.tools,
				disallowedTools: definition.disallowedTools ?? existing.disallowedTools,
			};
		} else {
			definitions[definition.name] = definition;
		}
	}

	cached = buildCatalogFromDefinitions(definitions, discovered.diagnostics);
	cachedCwd = cwd;
	return cached;
}

export function getCachedCatalog(): AgentCatalog {
	return cached ?? getBuiltinCatalog();
}

export function invalidateAgentCatalog(): void {
	cached = null;
	cachedCwd = null;
}

export function getAgentDefinition(name: string, catalog?: AgentCatalog): AgentDefinition | undefined {
	return (catalog ?? getCachedCatalog()).definitions[name];
}
