import { useRef, useCallback } from 'react';
import type { SecurityManager } from '../../security/index.js';
import type { CustomProviderConfig } from '../../services/config.js';
import { loadConfig, saveConfig } from '../../services/config.js';
import { getAuthKey, lookupContextWindow } from '../utils/model-config.js';
import { read as readCredential } from '../../services/auth-store.js';
import { resolveProviderHeaders } from '../../services/model-service.js';
import { showToast } from '../components/toast.js';
import { filterToolsByAgent, getAgentDefinition } from '../../agents/index.js';
import type { AgentRegistryConfig } from '../../agents/registry.js';
import { createSecurityManager } from '../../security/index.js';
import type { PermissionRequest, PermissionConfig, SecurityConfig } from '../../security/types.js';
import type { SessionManager } from '../../services/session-manager.js';
import type { SessionStore } from '../../services/session-store.js';
import { initProviders } from '@mohanscodex/spectra-ai';
import type { AssistantMessage, Context, Message, ContextMessage } from '@mohanscodex/spectra-ai';
import { Agent } from '@mohanscodex/spectra-agent';
import type { AgentTool, BeforeModelCallContext } from '@mohanscodex/spectra-agent';
import { pruneStaleSkills } from '../../services/skill-store.js';
import { createAllToolsWithSecurity, discoverAndCreateSkillTools } from '../../tools/index.js';
import type { AskHandler } from '../../tools/ask.js';
import { buildContextMessages, loadContext } from '../../services/context.js';
import {
	completeContextSnapshot,
	createPreparedContextSnapshot,
	restoreLatestContextSnapshot,
} from '../../services/context-usage.js';
import type {
	ContextAttribution,
	ContextUsageSnapshot,
	PreparedContextSnapshot,
} from '../../services/context-usage.js';
import { createTransformContextFn } from '../../services/compaction.js';
import type { CompactionModelInfo } from '../../services/compaction.js';



interface UseAgentDeps {
	securityRef: React.MutableRefObject<SecurityManager | null>;
	securityConfig: { permission?: PermissionConfig; security?: SecurityConfig };
	enqueuePermission: (req: PermissionRequest) => void;
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionId: React.MutableRefObject<string | null>;
	requestAsk: AskHandler;
}
export function useAgent(deps: UseAgentDeps) {
	const { securityRef, securityConfig, enqueuePermission, sessionStore, sessionId, requestAsk } = deps;

	// One Agent instance per session; idle configuration changes do not discard runtime state.
	const agentsMapRef = useRef(new Map<string, Agent>());
	const compactionModelsRef = useRef(new Map<string, CompactionModelInfo>());
	const agentConfigFingerprintsRef = useRef(new Map<string, string>());
	const contextAttributionRef = useRef(new Map<string, ContextAttribution>());
	const preparedContextRef = useRef(new Map<string, PreparedContextSnapshot>());
	const contextUsageRef = useRef(new Map<string, ContextUsageSnapshot>());

	const initSecurityManager = useCallback(
		(cwd: string) => {
			if (securityRef.current) return securityRef.current;

			const manager = createSecurityManager({
				config: securityConfig.permission,
				security: securityConfig.security,
				cwd,
				onWarning: (message) => showToast(message, 'warn'),
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
								if (entry && typeof entry === 'object' && !Array.isArray(entry)) { (entry as Record<string, string>)[rule.pattern] = 'allow'; }
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

	// Resolve model config, tools, and system prompt for a given session configuration.
	// Used by both first-creation and Agent.configure() reconfiguration paths.
	const resolveAgentConfig = useCallback(
		async (
			sid: string,
			sModel: string,
			sProvider: string,
			sAgent: string,
			sCustomProviders: Record<string, CustomProviderConfig>,
			sThinkingEffort: string | undefined,
		) => {
			const customCfg = sCustomProviders[sProvider];
			const cred = readCredential(sProvider);
			let resolvedBaseUrl = customCfg?.baseUrl;
			if (!customCfg && sProvider === 'snowflake-cortex' && cred?.type === 'oauth' && cred.accountId) {
				resolvedBaseUrl = `https://${cred.accountId}.snowflakecomputing.com/api/v2/cortex/v1`;
			}
			const resolvedHeaders = resolveProviderHeaders(sProvider, cred, customCfg?.headers);

			const def = getAgentDefinition(sAgent);
			const manager = initSecurityManager(process.cwd());

			const agentConfig: AgentRegistryConfig = {
				model: {
					id: sModel,
					name: sModel,
					provider: sProvider,
					api: sProvider,
					baseUrl: resolvedBaseUrl,
					headers: resolvedHeaders,
				},
				getApiKey: (p: string) => getAuthKey(p),
			};

			const allTools = createAllToolsWithSecurity(manager, agentConfig, sessionStore.current, sid, requestAsk);

			let skillTools: AgentTool[] = [];
			let skillCount = 0;
			try {
				const { skills, tools } = await discoverAndCreateSkillTools();
				skillTools = tools;
				skillCount = skills.size;
			} catch {}

			const agentTools = def ? filterToolsByAgent([...allTools, ...skillTools], sAgent) : [...allTools, ...skillTools];

			const sessionEntry = sessionStore.current?.get(sid);
			const sessionCwd = sessionEntry?.directory || process.cwd();
			const sessionStartedAt = sessionEntry?.created ? new Date(sessionEntry.created) : undefined;
			const config = loadConfig(sessionCwd);
			const context = loadContext(sessionCwd, {
				model: sModel,
				provider: sProvider,
				sessionStartedAt,
				references: config.references,
			});

			const skillsHint = skillCount > 0
				? `\n\nSkills are available. Use the find_skills tool to discover skills by topic or task, then use the skill tool to load a specific skill's instructions.`
				: '';
			const systemPrompt = [context.systemPrompt + skillsHint].filter(Boolean).join('\n\n');
			const contextMessages = buildContextMessages(def?.prompt);
			const contextWindow = customCfg?.models?.[sModel]?.contextWindow ?? lookupContextWindow(sModel, sProvider);
			const sessionKey = `${sid}:session`;
			const attribution: ContextAttribution = {
				baseSystemPrompt: context.sections.baseSystemPrompt,
				systemContext: [
					context.sections.environment,
					context.sections.projectReferences,
					...context.sections.instructionFiles,
				].filter(Boolean),
				skillsHint,
				fingerprint: context.fingerprint,
			};
			contextAttributionRef.current.set(sessionKey, attribution);
			const preparedTools = agentTools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));
			const initialSnapshot = createPreparedContextSnapshot({
				context: { systemPrompt, messages: [], tools: preparedTools, contextMessages },
				attribution,
				modelId: sModel,
				providerId: sProvider,
				contextWindow,
			});
			compactionModelsRef.current.set(sessionKey, {
				model: sModel,
				provider: sProvider,
				contextWindow,
				nonMessageTokens: initialSnapshot.nonMessageTokens,
			});

			const model = {
				id: sModel,
				name: sModel,
				provider: sProvider,
				api: sProvider,
				baseUrl: resolvedBaseUrl,
				headers: resolvedHeaders,
			};

			return {
				model,
				systemPrompt,
				tools: agentTools,
				maxTurns: def?.maxTurns,
				contextMessages,
				streamOptions: sThinkingEffort ? { thinkingEffort: sThinkingEffort } : undefined,
			};
		},
		[initSecurityManager, requestAsk, sessionStore],
	);

	function runtimeFingerprint(config: {
		model: { id: string; provider: string };
		systemPrompt: string;
		tools: AgentTool[];
		maxTurns?: number;
		streamOptions?: unknown;
		contextMessages?: readonly ContextMessage[];
	}): string {
		return JSON.stringify({
			model: config.model,
			systemPrompt: config.systemPrompt,
			tools: config.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
			maxTurns: config.maxTurns,
			streamOptions: config.streamOptions,
			contextMessages: config.contextMessages,
		});
	}


	// Per-session agent: one Agent instance lives in the map keyed by sessionId.
	// Non-streaming calls apply Agent.configure() atomically; streaming returns the live agent as-is.
	// History is NEVER restored here — callers must use restoreSessionHistory explicitly,
	// avoiding duplication with the user message that use-chat-submit persists before this call.
	const getOrCreateAgent = useCallback(
		async (
			sessionId: string,
			selectedModel: string | null,
			provider: string | null,
			selectedAgent: string,
			customProviders: Record<string, CustomProviderConfig>,
			thinkingEffort: string | undefined,
			history?: Message[],
		) => {
			if (!selectedModel || !provider) return null;

			const sessionKey = `${sessionId}:session`;

			// --- Existing agent for this session ---
			const existing = agentsMapRef.current.get(sessionKey);
			if (existing) {
				// While streaming, return as-is — steering handles queued messages
				// and configure() would throw.
				if (existing.isStreaming) return existing;

				// Non-streaming: rebuild runtime config and apply atomically.
				// History, abort controller, and event listeners are preserved.
				const runtimeConfig = await resolveAgentConfig(
					sessionId, selectedModel, provider, selectedAgent, customProviders, thinkingEffort,
				);
				const fingerprint = runtimeFingerprint(runtimeConfig);
				if (agentConfigFingerprintsRef.current.get(sessionKey) === fingerprint) return existing;
				try {
					existing.configure(runtimeConfig);
					agentConfigFingerprintsRef.current.set(sessionKey, fingerprint);
				} catch (error) {
					if (existing.isStreaming) return existing;
					throw error;
				}
				return existing;
			}

			// --- First creation for this session ---
			initProviders();

			const runtimeConfig = await resolveAgentConfig(
				sessionId, selectedModel, provider, selectedAgent, customProviders, thinkingEffort,
			);

			const transformContext = createTransformContextFn(
				() => compactionModelsRef.current.get(sessionKey) ?? null,
				(p: string) => getAuthKey(p),
				{},
				{
					onCompacted: (compacted) => {
						const session = sessionStore.current.get(sessionId);
						if (!session) return;
						session.messages = [...compacted];
						sessionStore.current.save(session);
					},
				},
			);

			const beforeModelCall = async (prepared: BeforeModelCallContext) => {
				const attribution = contextAttributionRef.current.get(sessionKey);
				const modelInfo = compactionModelsRef.current.get(sessionKey);
				if (!attribution || !modelInfo) return undefined;
				const preparedContext: Context = {
					systemPrompt: prepared.systemPrompt,
					messages: [...prepared.messages],
					tools: [...prepared.tools],
					contextMessages: prepared.contextMessages,
				};
				const snapshot = createPreparedContextSnapshot({
					context: preparedContext,
					attribution,
					modelId: prepared.model.id,
					providerId: prepared.model.provider,
					contextWindow: modelInfo.contextWindow,
				});
				preparedContextRef.current.set(sessionKey, snapshot);
				compactionModelsRef.current.set(sessionKey, {
					...modelInfo,
					nonMessageTokens: snapshot.nonMessageTokens,
				});
				return undefined;
			};

			const agent = new Agent({
				...runtimeConfig,
				getApiKey: (p: string) => getAuthKey(p),
				transformContext,
				beforeModelCall,
			});

			if (history && history.length > 0) agent.restoreHistory(history);
			agentsMapRef.current.set(sessionKey, agent);
			agentConfigFingerprintsRef.current.set(sessionKey, runtimeFingerprint(runtimeConfig));

			// Fire-and-forget maintenance
			pruneStaleSkills().catch(() => {});


			return agent;
		},
		[initSecurityManager, sessionStore, resolveAgentConfig],
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
			if (agent && !agent.isStreaming && messages.length > 0) {
				agent.restoreHistory(messages);
			}
				const restored = restoreLatestContextSnapshot(messages);
				if (restored) contextUsageRef.current.set(`${sessionId}:session`, restored);
			return agent;
		},
		[getOrCreateAgent],
	);

	// Abort a specific session's active run.
	const abortSession = useCallback((sessionId: string) => {
		const key = `${sessionId}:session`;
		agentsMapRef.current.get(key)?.abort();
	}, []);

	const recordContextUsage = useCallback((sessionId: string, assistant: AssistantMessage) => {
		const key = `${sessionId}:session`;
		const prepared = preparedContextRef.current.get(key);
		if (!prepared) return undefined;
		const snapshot = completeContextSnapshot(prepared, assistant);
		contextUsageRef.current.set(key, snapshot);
		return snapshot;
	}, []);

	const getContextUsage = useCallback((sessionId: string | null) => {
		if (!sessionId) return undefined;
		return contextUsageRef.current.get(`${sessionId}:session`);
	}, []);

	const removeSessionAgent = useCallback((sessionId: string) => {
		const key = `${sessionId}:session`;
		const agent = agentsMapRef.current.get(key);
		if (agent) {
			agent.reset();
			agentsMapRef.current.delete(key);
			compactionModelsRef.current.delete(key);
			agentConfigFingerprintsRef.current.delete(key);
			contextAttributionRef.current.delete(key);
			preparedContextRef.current.delete(key);
			contextUsageRef.current.delete(key);
		}
	}, []);

	return {
		agentsMapRef,
		getOrCreateAgent,
		restoreSessionHistory,
		abortSession,
		removeSessionAgent,
		recordContextUsage,
		getContextUsage,
		contextUsageRef,
	};
}

export function createSessionSecurityManager(
	securityConfig: { permission?: PermissionConfig; security?: SecurityConfig },
	enqueuePermission: (req: PermissionRequest) => void,
): SecurityManager {
	const manager = createSecurityManager({
		config: securityConfig.permission,
		security: securityConfig.security,
		cwd: process.cwd(),
		onWarning: (message) => showToast(message, 'warn'),
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
						if (entry && typeof entry === 'object' && !Array.isArray(entry)) { (entry as Record<string, string>)[rule.pattern] = 'allow'; }
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

export function createSessionFactory(
	securityConfig: { permission?: PermissionConfig; security?: SecurityConfig },
	enqueuePermission: (req: PermissionRequest) => void,
	sessionStore?: SessionStore,
) {
	return async (
		model: string,
		provider: string,
		agentName: string,
		customProviders: Record<string, CustomProviderConfig>,
		thinkingEffort: string | undefined,
		securityManager: SecurityManager,
		sessionId?: string,
	) => {
		initProviders();
		const customCfg = customProviders[provider];

		const def = getAgentDefinition(agentName);

		const agentConfig: AgentRegistryConfig = {
			model: {
				id: model,
				name: model,
				provider,
				api: provider,
				baseUrl: customCfg?.baseUrl,
				headers: resolveProviderHeaders(provider, readCredential(provider), customCfg?.headers),
			},
			getApiKey: (p: string) => getAuthKey(p),
		};

		const allTools = createAllToolsWithSecurity(securityManager, agentConfig, undefined, sessionId);

		let skillTools: AgentTool[] = [];
		let skillCount = 0;
		try {
			const { skills, tools } = await discoverAndCreateSkillTools();
			skillTools = tools;
			skillCount = skills.size;
		} catch {}

		const agentTools = def ? filterToolsByAgent([...allTools, ...skillTools], agentName) : [...allTools, ...skillTools];

		const sessionEntry = sessionId ? sessionStore?.get(sessionId) : undefined;
		const sessionCwd = sessionEntry?.directory || process.cwd();
		const config = loadConfig(sessionCwd);
		const context = loadContext(sessionCwd, {
			model,
			provider,
			sessionStartedAt: sessionEntry?.created ? new Date(sessionEntry.created) : undefined,
			references: config.references,
		});

		const skillsHint = skillCount > 0
			? `\n\nSkills are available. Use the find_skills tool to discover skills by topic or task, then use the skill tool to load a specific skill's instructions.`
			: '';
		const systemPrompt = [context.systemPrompt + skillsHint].filter(Boolean).join('\n\n');
		const contextMessages = buildContextMessages(def?.prompt);
		const contextWindow = customCfg?.models?.[model]?.contextWindow ?? lookupContextWindow(model, provider);
		const attribution: ContextAttribution = {
			baseSystemPrompt: context.sections.baseSystemPrompt,
			systemContext: [
				context.sections.environment,
				context.sections.projectReferences,
				...context.sections.instructionFiles,
			].filter(Boolean),
			skillsHint,
			fingerprint: context.fingerprint,
		};
		const preparedTools = agentTools.map((tool) => ({
			name: tool.name,
			description: tool.description,
			parameters: tool.parameters,
		}));
		const initialSnapshot = createPreparedContextSnapshot({
			context: { systemPrompt, messages: [], tools: preparedTools, contextMessages },
			attribution,
			modelId: model,
			providerId: provider,
			contextWindow,
		});
		const transformContext = createTransformContextFn(
			() => ({
				model,
				provider,
				contextWindow,
				nonMessageTokens: initialSnapshot.nonMessageTokens,
			}),
			(p: string) => getAuthKey(p),
			{},
			{
				onCompacted: (compacted) => {
					if (!sessionStore || !sessionId) return;
					const session = sessionStore.get(sessionId);
					if (!session) return;
					session.messages = [...compacted];
					sessionStore.save(session);
				},
			},
		);


		const agent = new Agent({
			model: {
				id: model,
				name: model,
				provider,
				api: provider,
				baseUrl: customCfg?.baseUrl,
				headers: resolveProviderHeaders(provider, readCredential(provider), customCfg?.headers),
			},
			systemPrompt,
			contextMessages,
			getApiKey: (p: string) => getAuthKey(p),
			tools: agentTools,
			maxTurns: def?.maxTurns,
			streamOptions: thinkingEffort ? { thinkingEffort } : undefined,
			transformContext,
		});

		return { agent, config: agentConfig, securityManager };
	};
}
