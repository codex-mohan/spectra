import { useRef, useCallback } from 'react';
import type { SecurityManager } from '../../security/index.js';
import type { CustomProviderConfig } from '../../services/config.js';
import { loadConfig, saveConfig } from '../../services/config.js';
import { getAuthKey } from '../utils/model-config.js';
import { AGENT_DEFINITIONS } from '../../agents/index.js';
import type { AgentRegistryConfig } from '../../agents/registry.js';
import { createSecurityManager } from '../../security/index.js';
import type { PermissionRequest } from '../../security/types.js';
import type { SessionManager } from '../../services/session-manager.js';
import type { SessionStore } from '../../services/session-store.js';
import type { Message } from '@mohanscodex/spectra-ai';
import type { AgentTool } from '@mohanscodex/spectra-agent';
import { pruneStaleSkills } from '../../services/skill-store.js';

const MEMORY_SKILL_DISTINCTION = `Memory and skills have different jobs:
- Memory is for durable facts: user preferences, project facts, decisions, constraints, and reminders.
- Skills are for reusable procedures: when to use a workflow, steps to run it, checks to verify it, and pitfalls.
- Store facts in memory; use skills only for repeatable workflows.`;

interface UseAgentDeps {
	securityRef: React.MutableRefObject<SecurityManager | null>;
	securityConfig: { permission: any; security: any };
	enqueuePermission: (req: PermissionRequest) => void;
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionId: React.MutableRefObject<string | null>;
}

export function useAgent(deps: UseAgentDeps) {
	const { securityRef, securityConfig, enqueuePermission, sessionStore, sessionId } = deps;

	// Per-session agent Map — like opencode's Map<SessionID, Runner>
	const agentsMapRef = useRef(new Map<string, any>());
	const lastAgentRef = useRef<string | null>(null);

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

	// Like opencode's runner(sessionID, onInterrupt) — get or create a per-session agent
	const getOrCreateAgent = useCallback(
		async (
			sessionId: string,
			selectedModel: string | null,
			provider: string | null,
			selectedAgent: string,
			customProviders: Record<string, CustomProviderConfig>,
			thinkingEffort: string | undefined,
		) => {
			if (!selectedModel || !provider) return null;

			const agentKey = `${selectedAgent}:${selectedModel}:${provider}:${thinkingEffort || ''}`;
			const sessionKey = `${sessionId}:${agentKey}`;

			// Return existing agent for this session+config combination
			const existing = agentsMapRef.current.get(sessionKey);
			if (existing) return existing;

			// Clean up any old agent for this session (different config)
			for (const [key, agent] of agentsMapRef.current.entries()) {
				if (key.startsWith(`${sessionId}:`) && key !== sessionKey) {
					agent.reset();
					agentsMapRef.current.delete(key);
				}
			}

			const { Agent } = await import('@mohanscodex/spectra-agent');
			const { initProviders } = await import('@mohanscodex/spectra-ai');
			initProviders();
			const { createAllToolsWithSecurity } = await import('../../tools/index.js');
			const customCfg = customProviders[provider];

			const def = AGENT_DEFINITIONS[selectedAgent];

			const manager = initSecurityManager(process.cwd());

			const agentConfig: AgentRegistryConfig = {
				model: {
					id: selectedModel,
					name: selectedModel,
					provider,
					api: provider,
					baseUrl: customCfg?.baseUrl,
					headers: customCfg?.headers,
				},
				getApiKey: (p: string) => getAuthKey(p),
			};

			const allTools = createAllToolsWithSecurity(manager, agentConfig, sessionStore.current, sessionId);
			const { filterToolsByAgent } = await import('../../agents/index.js');

			// Discover skills and create skill tools
			let skillTools: AgentTool[] = [];
			let skillCount = 0;
			try {
				const { discoverAndCreateSkillTools } = await import('../../tools/index.js');
				const { skills, tools } = await discoverAndCreateSkillTools();
				skillTools = tools;
				skillCount = skills.size;
			} catch {}

			const agentTools = def ? filterToolsByAgent([...allTools, ...skillTools], selectedAgent) : [...allTools, ...skillTools];

			const { loadContext } = await import('../../services/context.js');
			const context = loadContext();

			const { loadMemorySnapshot } = await import('../../services/memory.js');
			const memorySnapshot = loadMemorySnapshot();

			const skillsHint = skillCount > 0
				? `\n\nSkills are available. Use the find_skills tool to discover skills by topic or task, then use the skill tool to load a specific skill's instructions.`
				: '';
			const systemPrompt = [context.systemPrompt + skillsHint, MEMORY_SKILL_DISTINCTION, memorySnapshot, def?.prompt].filter(Boolean).join('\n\n');

			const { createTransformContextFn } = await import('../../services/compaction.js');
			const transformContext = createTransformContextFn(
				() => ({ model: selectedModel, provider }),
				(p: string) => getAuthKey(p),
			);

			const agent = new Agent({
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
				transformContext,
			});

			agentsMapRef.current.set(sessionKey, agent);
			lastAgentRef.current = selectedAgent;

			// Prune stale junk skills (fire-and-forget, once per agent creation)
			pruneStaleSkills().catch(() => {});

			// Restore conversation history from persistent storage
			if (sessionId) {
				const sessionData = sessionStore.current.get(sessionId);
				if (sessionData && sessionData.messages.length > 0) {
					agent.restoreHistory(sessionData.messages);
				}
			}

			return agent;
		},
		[initSecurityManager, sessionStore, sessionId],
	);

	// Restore a session's message history into its agent (called when loading a session)
	const restoreSessionHistory = useCallback(
		async (
			sessionId: string,
			selectedModel: string | null,
			provider: string | null,
			selectedAgent: string,
			customProviders: Record<string, CustomProviderConfig>,
			thinkingEffort: string | undefined,
			messages: Message[],
		) => {
			const agent = await getOrCreateAgent(sessionId, selectedModel, provider, selectedAgent, customProviders, thinkingEffort);
			if (agent && messages.length > 0) {
				agent.restoreHistory(messages);
			}
			return agent;
		},
		[getOrCreateAgent],
	);

	// Abort a specific session's agent — like opencode's cancel(sessionID)
	const abortSession = useCallback((sessionId: string) => {
		for (const [key, agent] of agentsMapRef.current.entries()) {
			if (key.startsWith(`${sessionId}:`)) {
				agent.abort();
				return;
			}
		}
	}, []);

	// Reset agents for the current session (used when switching models/agents/thinking effort)
	const resetAgentForModelSwitch = useCallback(() => {
		const currentSessionId = sessionId.current;
		if (!currentSessionId) return;
		for (const [key, agent] of agentsMapRef.current.entries()) {
			if (key.startsWith(`${currentSessionId}:`)) {
				agent.reset();
				agentsMapRef.current.delete(key);
			}
		}
	}, [sessionId]);

	// Remove a specific session's agents (used when deleting a session)
	const removeSessionAgent = useCallback((sessionId: string) => {
		for (const [key, agent] of agentsMapRef.current.entries()) {
			if (key.startsWith(`${sessionId}:`)) {
				agent.reset();
				agentsMapRef.current.delete(key);
			}
		}
	}, []);

	return {
		agentsMapRef,
		lastAgentRef,
		getOrCreateAgent,
		restoreSessionHistory,
		abortSession,
		removeSessionAgent,
		resetAgentForModelSwitch,
	};
}

export function createSessionSecurityManager(
	securityConfig: { permission: any; security: any },
	enqueuePermission: (req: PermissionRequest) => void,
): SecurityManager {
	const manager = createSecurityManager({
		config: securityConfig.permission,
		security: securityConfig.security,
		cwd: process.cwd(),
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
	return manager;
}

export function createSessionFactory(securityConfig: { permission: any; security: any }, enqueuePermission: (req: PermissionRequest) => void) {
	return async (
		model: string,
		provider: string,
		agentName: string,
		customProviders: Record<string, CustomProviderConfig>,
		thinkingEffort: string | undefined,
		securityManager: SecurityManager,
		sessionId?: string,
	) => {
		const { Agent } = await import('@mohanscodex/spectra-agent');
		const { initProviders } = await import('@mohanscodex/spectra-ai');
		initProviders();
		const { createAllToolsWithSecurity } = await import('../../tools/index.js');
		const customCfg = customProviders[provider];

		const def = AGENT_DEFINITIONS[agentName];

		const agentConfig: AgentRegistryConfig = {
			model: {
				id: model,
				name: model,
				provider,
				api: provider,
				baseUrl: customCfg?.baseUrl,
				headers: customCfg?.headers,
			},
			getApiKey: (p: string) => getAuthKey(p),
		};

		const allTools = createAllToolsWithSecurity(securityManager, agentConfig, undefined, sessionId);
		const { filterToolsByAgent } = await import('../../agents/index.js');

		let skillTools: AgentTool[] = [];
		let skillCount = 0;
		try {
			const { discoverAndCreateSkillTools } = await import('../../tools/index.js');
			const { skills, tools } = await discoverAndCreateSkillTools();
			skillTools = tools;
			skillCount = skills.size;
		} catch {}

		const agentTools = def ? filterToolsByAgent([...allTools, ...skillTools], agentName) : [...allTools, ...skillTools];

		const { loadContext } = await import('../../services/context.js');
		const context = loadContext();

		const { loadMemorySnapshot } = await import('../../services/memory.js');
		const memorySnapshot = loadMemorySnapshot();

		const skillsHint = skillCount > 0
			? `\n\nSkills are available. Use the find_skills tool to discover skills by topic or task, then use the skill tool to load a specific skill's instructions.`
			: '';
		const systemPrompt = [context.systemPrompt + skillsHint, MEMORY_SKILL_DISTINCTION, memorySnapshot, def?.prompt].filter(Boolean).join('\n\n');

		const agent = new Agent({
			model: {
				id: model,
				name: model,
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

		return { agent, config: agentConfig, securityManager };
	};
}
