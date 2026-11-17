import { invalidateAgentCatalog, loadAgentCatalog } from '../agents/index.js';
import { invalidateSkillCatalog, loadAllSkills } from '../services/skill-catalog.js';
import { pluginHost } from '../plugins/host.js';
import { loadConfig } from '../services/config.js';
import { connectAllServers, listConnectedServers, shutdownAllServers } from '../integrations/mcp/index.js';
import { ALL_RELOAD_DOMAINS, runtimeRegistry, type ReloadDomain, type RuntimeChange } from './registry.js';

export interface ReloadResult extends RuntimeChange {
	errors: string[];
}

/** Invalidate cached registries and notify the app. Callers re-read what they render. */
export async function reloadRuntime(
	domains: readonly ReloadDomain[] = ALL_RELOAD_DOMAINS,
	cwd = process.cwd(),
): Promise<ReloadResult> {
	const selected = [...new Set(domains.length > 0 ? domains : ALL_RELOAD_DOMAINS)];
	const errors: string[] = [];
	if (selected.includes('agents')) {
		invalidateAgentCatalog();
		try { await loadAgentCatalog(cwd); } catch (error) { errors.push(`agents: ${message(error)}`); }
	}
	if (selected.includes('skills')) {
		invalidateSkillCatalog();
		try { await loadAllSkills(); } catch (error) { errors.push(`skills: ${message(error)}`); }
	}
	if (selected.includes('plugins')) {
		try { await pluginHost.reloadAll(); } catch (error) { errors.push(`plugins: ${message(error)}`); }
	}
	if (selected.includes('mcp')) {
		try {
			const connected = new Set(listConnectedServers().map((server) => server.name));
			const configs = (loadConfig(cwd).mcp ?? []).filter((server) => server.enabled !== false && (connected.size === 0 || connected.has(server.name)));
			await shutdownAllServers();
			await connectAllServers(configs);
		} catch (error) {
			errors.push(`mcp: ${message(error)}`);
		}
	}
	const change = runtimeRegistry.mark(selected);
	return { ...change, errors };
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
