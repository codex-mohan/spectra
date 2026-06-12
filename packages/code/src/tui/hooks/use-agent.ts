import { useRef, useCallback } from 'react';
import type { SecurityManager } from '../../security/index.js';
import type { CustomProviderConfig } from '../../services/config.js';
import { loadConfig, saveConfig } from '../../services/config.js';
import { getAuthKey } from '../utils/model-config.js';
import { AGENT_DEFINITIONS } from '../../agents/index.js';
import { AgentRegistry } from '../../agents/registry.js';
import { createSecurityManager } from '../../security/index.js';
import type { PermissionRequest } from '../../security/types.js';

interface UseAgentDeps {
	securityRef: React.MutableRefObject<SecurityManager | null>;
	securityConfig: { permission: any; security: any };
	enqueuePermission: (req: PermissionRequest) => void;
}

export function useAgent(deps: UseAgentDeps) {
	const { securityRef, securityConfig, enqueuePermission } = deps;

	const agentRef = useRef<any>(null);
	const lastAgentRef = useRef<string | null>(null);
	const lastModelRef = useRef<string | null>(null);
	const loadedSessionMessages = useRef<import('@mohanscodex/spectra-ai').Message[]>([]);

	const initSecurityManager = useCallback(
		(cwd: string) => {
			if (securityRef.current) return securityRef.current;

			const manager = createSecurityManager({
				config: securityConfig.permission,
				security: securityConfig.security,
				cwd,
				onPersist: (rules) => {
					try {
						const existing = loadConfig();
						const permission: Record<string, unknown> = {
							...(existing.permission ?? {}),
						};
						for (const rule of rules) {
							if (rule.action !== 'allow') continue;
							let entry = permission[rule.permission];
							if (!entry || typeof entry === 'string') {
								permission[rule.permission] = { [rule.pattern]: 'allow' };
							} else if (typeof entry === 'object') {
								(entry as Record<string, string>)[rule.pattern] = 'allow';
							}
						}
						existing.permission = permission as typeof existing.permission;
						saveConfig(existing);
					} catch {}
				},
			});
			manager.setListener((req) => {
				enqueuePermission(req);
			});
			securityRef.current = manager;
			return manager;
		},
		[securityRef, securityConfig, enqueuePermission],
	);

	const getOrCreateAgent = useCallback(
		async (
			selectedModel: string | null,
			provider: string | null,
			selectedAgent: string,
			customProviders: Record<string, CustomProviderConfig>,
			thinkingEffort: string | undefined,
		) => {
			if (!selectedModel || !provider) return null;

			const agentKey = `${selectedAgent}:${selectedModel}:${provider}:${thinkingEffort || ''}`;
			if (agentRef.current && lastModelRef.current === agentKey) return agentRef.current;

			const existingMessages = agentRef.current ? [...agentRef.current.messages] : loadedSessionMessages.current;

			const { Agent } = await import('@mohanscodex/spectra-agent');
			const { initProviders } = await import('@mohanscodex/spectra-ai');
			initProviders();
			const { createAllTools, createAllToolsWithSecurity } = await import('../../tools/index.js');
			const customCfg = customProviders[provider];

			const def = AGENT_DEFINITIONS[selectedAgent];

			const manager = initSecurityManager(process.cwd());

			const allTools = createAllToolsWithSecurity(manager);
			const { filterToolsByAgent } = await import('../../agents/index.js');

			// Discover skills and create skill tools
			let skillTools: import('@mohanscodex/spectra-agent').AgentTool[] = [];
			let skillCount = 0;
			try {
				const { discoverAndCreateSkillTools } = await import('../../tools/index.js');
				const { skills, tools } = await discoverAndCreateSkillTools();
				skillTools = tools;
				skillCount = skills.size;
			} catch {}

			const agentTools = def ? filterToolsByAgent([...allTools, ...skillTools], selectedAgent) : [...allTools, ...skillTools];

			let agentsMd = '';
			try {
				const agentsPath = `${process.cwd()}/AGENTS.md`;
				const { readFileSync, existsSync } = await import('fs');
				if (existsSync(agentsPath)) {
					agentsMd = readFileSync(agentsPath, 'utf-8');
				}
			} catch {}

			const { getSystemPrompt } = await import('../../utils/platform.js');

			const skillsHint = skillCount > 0
				? `\n\nSkills are available. Use the find_skills tool to discover skills by topic or task, then use the skill tool to load a specific skill's instructions.`
				: '';
			const systemPrompt = [getSystemPrompt() + skillsHint, agentsMd, def?.prompt].filter(Boolean).join('\n\n');

			agentRef.current = new Agent({
				model: {
					id: selectedModel,
					name: selectedModel,
					provider,
					api: provider,
					baseUrl: customCfg?.baseUrl,
					headers: customCfg?.headers,
				},
				systemPrompt,
				getApiKey: (p: string) => getAuthKey(p),
				tools: agentTools,
				maxTurns: def?.maxTurns ?? 10,
				streamOptions: thinkingEffort ? { thinkingEffort } : undefined,
			});

			AgentRegistry.setConfig({
				model: {
					id: selectedModel,
					name: selectedModel,
					provider,
					api: provider,
					baseUrl: customCfg?.baseUrl,
					headers: customCfg?.headers,
				},
				getApiKey: (p: string) => getAuthKey(p),
			});

			if (existingMessages.length > 0) {
				agentRef.current.restoreHistory(existingMessages);
			}

			lastModelRef.current = agentKey;
			lastAgentRef.current = selectedAgent;
			return agentRef.current;
		},
		[initSecurityManager],
	);

	const resetAgentForModelSwitch = useCallback(() => {
		agentRef.current = null;
		lastModelRef.current = null;
	}, []);

	return {
		agentRef,
		lastAgentRef,
		loadedSessionMessages,
		getOrCreateAgent,
		resetAgentForModelSwitch,
	};
}
