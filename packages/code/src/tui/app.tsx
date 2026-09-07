import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import type { CliRenderer } from '@opentui/core';
import { execFileSync } from 'child_process';
import { c, SPINNER } from './theme.js';
import { ChatArea } from './components/chat-area.js';
import { ActivityFooter } from './components/activity-footer.js';
import { PendingQueue } from './components/pending-queue.js';
import { CommandPalette } from './components/command-palette.js';
import { PromptBar, type PromptBarRef } from './prompt-bar.js';
import { FileAutocomplete } from './components/file-autocomplete.js';
import { HomeTitle } from './components/home-title.js';
import { Tips } from './tips.js';
import { titlecase } from './utils.js';
import type { ChatMessage } from './types.js';
import { SessionStore } from '../services/session-store.js';
import { APP_VERSION } from '../services/app-version.js';
import { SessionManager } from '../services/session-manager.js';
import { SnapshotManager } from '../services/snapshot-manager.js';
import { PromptHistoryService } from '../services/prompt-history.js';
import type { Message } from '@mohanscodex/spectra-ai';
import { ProviderDialog } from './ui/provider-dialog.js';
import { SessionList } from './ui/session-list.js';
import { ModelSwitcher } from './ui/model-switcher.js';
import { ManageProvidersDialog } from './ui/manage-providers-dialog.js';
import { DoctorDialog } from './ui/doctor-dialog.js';
import { AboutDialog } from './ui/about-dialog.js';
import { AgentSwitcher } from './ui/agent-switcher.js';
import { ThinkingEffortDialog } from './ui/thinking-effort-dialog.js';
import { McpToggleDialog } from './ui/mcp-toggle-dialog.js';
import { DebugDialog } from './ui/debug-dialog.js';
import { UpdateDialog, UPDATE_COMMAND } from './ui/update-dialog.js';
import { SessionStatsDialog } from './ui/session-stats-dialog.js';
import { ContextUsageDialog } from './ui/context-usage-dialog.js';
import { UsageDialog } from './ui/usage-dialog.js';
import { MemoryDialog } from './ui/memory-dialog.js';
import { SettingsDialog } from './ui/settings-dialog.js';
import { SkillsDialog } from './ui/skills-dialog.js';
import { MessageControls } from './ui/message-controls.js';
import { AskMenu } from './ui/ask-dialog.js';
import { ToastContainer, showToast } from './components/toast.js';
import { SubagentNav } from './components/subagent-footer.js';
import clipboard from 'clipboardy';
import { loadPricingFromModelsDev, formatCost, isFreeModel } from '@mohanscodex/spectra-ai';
import { buildCmdItems } from './commands.js';
import { slashHead } from './slash-commands.js';
import { SlashAutocomplete } from './components/slash-autocomplete.js';
import { type ArgCompletion, type CommandDefinition, buildCommandRegistry, type ResolvedCommand } from './command-types.js';
import { ArgAutocomplete } from './components/arg-autocomplete.js';
import { checkForUpdate } from './utils/update-check.js';
import { VERSION } from './utils/version.js';
import { setTerminalTitle, formatSessionTitle } from './utils/terminal-title.js';
import { loadConfig, type CustomProviderConfig } from '../services/config.js';
import { registerAllCustomProviders } from '../services/custom-providers.js';
import { PermissionDialog } from './ui/permission-dialog.js';
import { PLACEHOLDERS } from './app-constants.js';
import { getBuiltinCatalog, loadAgentCatalog, type AgentCatalog } from '../agents/index.js';
import { resolveAgentAccentColor } from './utils/agent-color.js';

import { loadSavedConfig, saveModelConfig, fmtCtx, lookupContextWindow } from './utils/model-config.js';
import { sdkMessagesToChatMessages, sumTurnTokens } from './utils/session-messages.js';
import { usePermissionQueue } from './hooks/use-permission-queue.js';
import { useRevert } from './hooks/use-revert.js';
import { useAgent, createSessionFactory, createSessionSecurityManager } from './hooks/use-agent.js';
import { useChatSubmit } from './hooks/use-chat-submit.js';
import { useAppKeyboard } from './hooks/use-app-keyboard.js';
import { useSessionState } from './hooks/use-session-state.js';
import { cycleEffort } from './variant-cycle.js';
import type { SecurityManager } from '../security/index.js';
import { backgroundTasks } from '../services/background-tasks.js';
import { loadTemplateDefinitions, templatesToCommands } from '../command/index.js';
import { createContextBreakdown, restoreLatestContextSnapshot } from '../services/context-usage.js';
import type { AskHandler, AskToolDetails, AskToolInput } from '../tools/ask.js';

function orderPaletteCommands(entries: readonly ResolvedCommand[]): ResolvedCommand[] {
	const templates = entries.filter((entry) => entry.definition.category === 'Templates');
	if (templates.length === 0) return [...entries];

	const remaining = entries.filter((entry) => entry.definition.category !== 'Templates');
	let insertAt = remaining.length;
	for (let index = remaining.length - 1; index >= 0; index--) {
		if (remaining[index]?.definition.category === 'Agent') {
			insertAt = index + 1;
			break;
		}
	}

	return [...remaining.slice(0, insertAt), ...templates, ...remaining.slice(insertAt)];
}

export function App({ renderer }: { renderer: CliRenderer }) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();

	// --- State ---
	const [savedConfig, setSavedConfig] = useState(loadSavedConfig);
	const [customProviders, setCustomProviders] = useState<Record<string, CustomProviderConfig>>(() => {
		const cfg = loadConfig();
		const cp = cfg.providers || {};
		registerAllCustomProviders(cp);
		return cp;
	});
	const [route, setRoute] = useState<'home' | 'chat'>('home');
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const [showCmd, setShowCmd] = useState(false);
	const [cmdFilter, setCmdFilter] = useState('');
	const [cmdSelected, setCmdSelected] = useState(0);
	const [showThinking, setShowThinking] = useState(true);
	const [showToolCalls, setShowToolCalls] = useState(true);

	const [submitKey, setSubmitKey] = useState(0);
	const [dialogStep, setDialogStep] = useState<any>(null);
	const [askRequest, setAskRequest] = useState<AskToolInput | null>(null);
	const [updateVersion, setUpdateVersion] = useState<string | null>(null);
	const [placeholderIdx, setPlaceholderIdx] = useState(0);
	const [navKey, setNavKey] = useState(0);
	const [homeKey, setHomeKey] = useState(0);
	const [interruptKey, setInterruptKey] = useState(0);
	const [msgControls, setMsgControls] = useState<ChatMessage | null>(null);
	const [revertPoint, setRevertPoint] = useState<string | null>(null);
	const [draftText, setDraftText] = useState('');
	const [slashSelected, setSlashSelected] = useState(0);
	const [slashArgSelected, setSlashArgSelected] = useState(0);
	const [promptPosition, setPromptPosition] = useState({ top: 0, left: 0, width: 0 });

	// Child session view-switching state (Phase 1)
	const [viewingChildSession, setViewingChildSession] = useState<string | null>(null);
	const parentSessionIdRef = useRef<string | null>(null);

	// Per-session state
	const sessionState = useSessionState();
	const messages = sessionState.activeState.messages;
	const pendingSteering = sessionState.activeState.pendingSteering;
	const pendingFollowUp = sessionState.activeState.pendingFollowUp;
	const isLoading = sessionState.activeState.isLoading;
	const status = sessionState.activeState.status;
	const tokenUsage = sessionState.activeState.tokenUsage;
	const elapsedMs = sessionState.activeState.elapsedMs;
	const tokPerSec = sessionState.activeState.tokPerSec;
	const selectedAgent = sessionState.activeState.selectedAgent;
	const turnCount = messages.filter((m: any) => m.role === 'user').length;
	const sessionTokens = useMemo(() => sumTurnTokens(messages), [messages]);
	const selectedModel = sessionState.activeState.selectedModel ?? savedConfig.model;
	const selectedProvider = sessionState.activeState.selectedProvider ?? savedConfig.provider;
	const thinkingEffort = sessionState.activeState.thinkingEffort;
	const contextBreakdown = useMemo(
		() => sessionState.activeState.contextUsage ? createContextBreakdown(sessionState.activeState.contextUsage) : undefined,
		[sessionState.activeState.contextUsage],
	);
	const selectedAgentRef = useRef(selectedAgent);
	selectedAgentRef.current = selectedAgent;
	const selectedModelRef = useRef(selectedModel);
	selectedModelRef.current = selectedModel;
	const selectedProviderRef = useRef(selectedProvider);
	selectedProviderRef.current = selectedProvider;
	const thinkingEffortRef = useRef(thinkingEffort);
	thinkingEffortRef.current = thinkingEffort;

	// Setters for active session (UI-driven changes)
	const setMessages = (fn: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
		const id = sessionState.activeSessionId || '';
		if (typeof fn === 'function') sessionState.setMessagesIn(id, fn);
		else sessionState.set(id, { messages: fn });
	};
	const updateMessage = (msgId: string, patch: Partial<ChatMessage>) => {
		sessionState.updateMessageIn(sessionState.activeSessionId || '', msgId, patch);
	};
	const setIsLoading = (v: boolean | ((prev: boolean) => boolean)) => {
		const id = sessionState.activeSessionId || '';
		const current = sessionState.getState(id);
		const resolved = typeof v === 'function' ? v(current.isLoading) : v;
		sessionState.setLoadingIn(id, resolved);
	};
	const setStatus = (s: string | ((prev: string) => string)) => {
		const id = sessionState.activeSessionId || '';
		const current = sessionState.getState(id);
		const resolved = typeof s === 'function' ? s(current.status) : s;
		sessionState.setStatusIn(id, resolved);
	};
	const setTokenUsage = (fn: { input: number; output: number } | ((prev: { input: number; output: number }) => { input: number; output: number })) => {
		const id = sessionState.activeSessionId || '';
		if (typeof fn === 'function') sessionState.setTokenUsageIn(id, fn);
		else sessionState.set(id, { tokenUsage: fn });
	};
	const setElapsedMs = (v: number | null | ((prev: number | null) => number | null)) => {
		const id = sessionState.activeSessionId || '';
		const current = sessionState.getState(id);
		const resolved = typeof v === 'function' ? v(current.elapsedMs) : v;
		sessionState.setElapsedMsIn(id, resolved);
	};
	const setTokPerSec = (v: number | null | ((prev: number | null) => number | null)) => {
		const id = sessionState.activeSessionId || '';
		const current = sessionState.getState(id);
		const resolved = typeof v === 'function' ? v(current.tokPerSec) : v;
		sessionState.setTokPerSecIn(id, resolved);
	};
	const setSelectedAgent = (v: string | ((prev: string) => string)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.selectedAgent) : v;
		selectedAgentRef.current = resolved;
		sessionState.setActive({ selectedAgent: resolved });
	};
	const setSelectedModel = (v: string | null | ((prev: string | null) => string | null)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.selectedModel) : v;
		selectedModelRef.current = resolved;
		sessionState.setActive({ selectedModel: resolved });
	};
	const setSelectedProvider = (v: string | null | ((prev: string | null) => string | null)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.selectedProvider) : v;
		selectedProviderRef.current = resolved;
		sessionState.setActive({ selectedProvider: resolved });
	};
	const setThinkingEffort = (v: string | undefined | ((prev: string | undefined) => string | undefined)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.thinkingEffort) : v;
		thinkingEffortRef.current = resolved;
		sessionState.setActive({ thinkingEffort: resolved });
	};

	const costDisplay = useMemo(() => {
		if (!selectedModel) return null;
		const cost = sessionState.activeState.costSoFar;
		if (cost > 0) return formatCost(cost);
		if (isFreeModel(selectedModel)) return 'Free';
		return null;
	}, [sessionState.activeState.costSoFar, selectedModel]);

	// --- Refs ---
	const promptTextareaRef = useRef<unknown>(null);
	const promptBarRef = useRef<PromptBarRef | null>(null);
	const sessionStore = useRef(new SessionStore());
	const sessionId = useRef<string | null>(null);
	const dialogKeyHandler = useRef<((key: unknown) => void) | null>(null);
	const askPendingRef = useRef<{
		resolve: (details: AskToolDetails | undefined) => void;
		signal?: AbortSignal;
		onAbort: () => void;
	} | null>(null);
	const isStreamingRef = useRef(false);
	const currentTurnStartRef = useRef<number | null>(null);
	const currentTurnMsgIdRef = useRef<string | null>(null);
	const snapshotManager = useRef(new SnapshotManager({ workdir: process.cwd() }));
	const promptHistoryService = useRef(new PromptHistoryService());

	const [securityConfig] = useState(() => {
		const cfg = loadConfig();
		return { permission: cfg.permission, security: cfg.security };
	});
	const [agentCatalog, setAgentCatalog] = useState<AgentCatalog>(() => getBuiltinCatalog());

	const settleAsk = useCallback((details: AskToolDetails | undefined) => {
		const pending = askPendingRef.current;
		if (!pending) return;
		pending.signal?.removeEventListener('abort', pending.onAbort);
		askPendingRef.current = null;
		setAskRequest(null);
		pending.resolve(details);
	}, []);

	const requestAsk = useCallback<AskHandler>((input, context) => {
		if (context.signal?.aborted || askPendingRef.current) return Promise.resolve(undefined);
		return new Promise((resolve) => {
			const onAbort = () => {
				const pending = askPendingRef.current;
				if (!pending || pending.resolve !== resolve) return;
				askPendingRef.current = null;
				setAskRequest(null);
				resolve(undefined);
			};
			askPendingRef.current = { resolve, signal: context.signal, onAbort };
			context.signal?.addEventListener('abort', onAbort, { once: true });
			setAskRequest(input);
		});
	}, []);

	const sessionManager = useRef<SessionManager>(
		new SessionManager(
			sessionStore.current,
			createSessionFactory(securityConfig, () => {}, sessionStore.current),
			() => createSessionSecurityManager(securityConfig, () => {}),
		),
	);

	// --- Template commands (loaded async from .spectra/commands) ---
	const [templateDefinitions, setTemplateDefinitions] = useState<readonly CommandDefinition[]>([]);
	const shownDiagnosticsRef = useRef(new Set<string>());
	const agentDiagShownRef = useRef(new Set<string>());

	useEffect(() => {
		let cancelled = false;
		loadAgentCatalog(process.cwd()).then((catalog) => {
			if (cancelled) return;
			setAgentCatalog(catalog);
			for (const d of catalog.diagnostics) {
				const key = `${d.sourcePath}:${d.message}`;
				if (agentDiagShownRef.current.has(key)) continue;
				agentDiagShownRef.current.add(key);
				showToast(d.message, 'warn');
			}
		}).catch(() => {});
		return () => { cancelled = true; };
	}, []);

	// --- Derived ---
	const provider = selectedProvider;
	const hasModel = selectedModel !== null && selectedProvider !== null;
	const agentAccentColor = resolveAgentAccentColor(agentCatalog.definitions[selectedAgent]?.color);
	const mcpCount = 0;
	const customProviderCount = Object.keys(customProviders).length;

	const cwdLabel = useMemo(() => {
		const home = process.env.HOME || process.env.USERPROFILE || '';
		const dir = process.cwd().replace(home, '~');
		try {
		const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
				encoding: 'utf-8',
				timeout: 2000,
				stdio: ['pipe', 'pipe', 'ignore'],
			}).trim();
			if (branch) return `${dir}:${branch}`;
		} catch {}
		return dir;
	}, []);

	// --- Effects ---
	useEffect(() => {
		setTerminalTitle('Spectra');
		const id = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 4000);
		return () => clearInterval(id);
	}, []);

	useEffect(() => {
		loadPricingFromModelsDev().catch(() => {});
		checkForUpdate().then((version) => {
			if (version) setUpdateVersion(version);
		});
	}, []);

	// Load template definitions asynchronously — non-blocking, diagnostics shown once via toast.
	useEffect(() => {
		let stale = false;
		const shellExecution = loadConfig().commands?.shellExecution !== false;
		loadTemplateDefinitions(process.cwd(), { shellExecution })
			.then(({ templates, diagnostics }) => {
				if (stale) return;
				setTemplateDefinitions(templatesToCommands(templates, process.cwd(), { shellExecution }));
				for (const d of diagnostics) {
					const key = `${d.kind}:${d.sourcePath}:${d.message}`;
					if (!shownDiagnosticsRef.current.has(key)) {
						shownDiagnosticsRef.current.add(key);
						showToast(`Template ${d.kind} (${d.sourcePath}): ${d.message}`, 'warn');
					}
				}
			})
			.catch((error) => {
				if (!stale) showToast(`Template loading failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
			});
		return () => { stale = true; };
	}, []);

	useEffect(() => {
		if (!isLoading) return;
		const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80);
		renderer.requestLive();
		return () => {
			clearInterval(id);
			renderer.dropLive();
		};
	}, [isLoading, renderer]);

	useEffect(() => {
		const handler = (selection: { getSelectedText: () => string }) => {
			const text = selection.getSelectedText();
			if (!text) return;
			setTimeout(() => {
				try {
					clipboard.writeSync(text);
					showToast('Copied to clipboard', 'success');
				} catch {}
			}, 2000);
		};
		renderer.on('selection', handler);
		return () => {
			renderer.off?.('selection', handler);
		};
	}, [renderer]);

	// ─── Phase 2/6: background task completion → inject result + toast ───
	useEffect(() => {
		const unsub = backgroundTasks.onCompletion((task) => {
			if (task.status === 'completed') {
				showToast(`Subagent @${task.agentType} completed: ${task.description}`.slice(0, 100), 'success');
			} else if (task.status === 'error') {
				showToast(`Subagent @${task.agentType} failed: ${task.error || 'unknown error'}`.slice(0, 100), 'error');
			}
			if (task.background) {
				sessionManager.current.injectBackgroundResult(
					task.parentSessionId,
					task.id,
					task.result || '',
					task.agentType,
					task.description,
				);
			}
		});
		return unsub;
	}, []);

	// ─── Child view keyboard handler is registered after switchToChildSession/exitChildView are defined ───

	// --- Hooks (order matters for ref lifecycle) ---
	const securityRef = useRef<SecurityManager | null>(null);

	const { permissionRequest, enqueuePermission, resolvePermission } = usePermissionQueue(securityRef);

	const { agentsMapRef, getOrCreateAgent, restoreSessionHistory, abortSession, removeSessionAgent, recordContextUsage } = useAgent({
		securityRef,
		securityConfig,
		enqueuePermission,
		sessionStore,
		sessionId,
		requestAsk,
	});

	const { revertedMessagesRef, revertDraftRef, runRevert, runRedo, discardRevert } = useRevert({
		sessionStore,
		sessionId,
		agentsMapRef,
		setMessages,
		setRevertPoint,
		snapshotManager,
		promptTextareaRef,
	});

	const handleCycleVariant = useCallback(() => {
		if (!provider) {
			showToast('No provider configured', 'warn');
			return;
		}
		const nextEffort = cycleEffort(provider, thinkingEffort);
		if (!nextEffort) {
			showToast('No variants available', 'info');
			return;
		}
		setThinkingEffort(nextEffort);
		showToast(nextEffort === 'none' ? 'Thinking: off' : `Thinking: ${nextEffort}`, 'info');
	}, [provider, thinkingEffort]);

	const cmdItems = useMemo(
		() =>
			buildCmdItems({
				renderer,
				sessionStore: sessionStore.current,
				sessionIdRef: sessionId,
				hasModel,
				selectedModel,
				provider,
				mcpCount,
				customProviderCount,
				messagesLength: messages.length,
				showThinking,
				showToolCalls,
				setRoute,
				setMessages,
				setStatus,
				setElapsedMs,
				setTokPerSec,
				setTokenUsage,
				setShowThinking,
				setShowToolCalls,
				setHomeKey,
				setNavKey,
				setDialogStep,
				onAgentSelected: (agent) => {
					setSelectedAgent(agent);
				},
				onCycleVariant: handleCycleVariant,
				currentEffort: thinkingEffort,
				selectedAgent,
				agentCatalog,
				onSecurityReset: () => {
					securityRef.current?.getReadTracker().reset();
					securityRef.current?.getDoomLoop().reset();
				},
			}),
		[
			renderer,
			hasModel,
			selectedModel,
			provider,
			mcpCount,
			customProviderCount,
			messages.length,
			showThinking,
			showToolCalls,
			handleCycleVariant,
			thinkingEffort,
			selectedAgent,
			agentCatalog,
			sessionStore,
			sessionId,
			setRoute,
			setMessages,
			setStatus,
			setElapsedMs,
			setTokPerSec,
			setTokenUsage,
			setShowThinking,
			setShowToolCalls,
			setHomeKey,
			setNavKey,
			setDialogStep,
			securityRef,
		],
	);

	const commandRegistry = useMemo(() => buildCommandRegistry(cmdItems, templateDefinitions), [cmdItems, templateDefinitions]);
	const resolvedEntries = commandRegistry.entries;

	const { handleSubmit, executeResolvedCommand, updateLastAssistantMeta } = useChatSubmit({
		sessionStore,
		sessionManager,
		sessionState,
		switchSession: sessionState.switchSession,
		sessionId,
		securityRef,
		snapshotManager,
		isStreamingRef,
		currentTurnStartRef,
		currentTurnMsgIdRef,
		revertPoint,
		getOrCreateAgent,
		recordContextUsage,
		selectedModel,
		provider,
		selectedAgent,
		selectedAgentRef,
		selectedModelRef,
		selectedProviderRef,
		thinkingEffortRef,
		customProviders,
		thinkingEffort,
		commandRegistry,
		setMessages,
		setIsLoading,
		setStatus,
		setRoute,
		setElapsedMs,
		setTokPerSec,
		setDraftText,
		setSlashSelected,
		setSubmitKey,
		setInterruptKey,
		setRevertPoint,
		discardRevert,
		setDialogStep,
		promptHistoryService,
	});

	// ─── Child session view-switching ───
	const switchToChildSession = useCallback((childId: string) => {
		const childData = sessionStore.current.get(childId);
		if (!childData) return;

		const { messages: childMsgs, tokenUsage: childTokens, costSoFar: childCost } = sdkMessagesToChatMessages({
			messages: childData.messages,
			model: childData.model,
			agent: childData.agent,
		});

		const restoredContext = restoreLatestContextSnapshot(childData.messages);
		sessionState.switchSession(childId);
		sessionState.set(childId, {
			messages: childMsgs,
			tokenUsage: childTokens,
			costSoFar: childCost,
			contextUsage: restoredContext,
			selectedModel: childData.model,
			selectedProvider: childData.provider || childData.model.split('/')[0],
			selectedAgent: childData.agent || 'build',
			thinkingEffort: childData.thinkingEffort || undefined,
			pendingSteering: [],
			pendingFollowUp: [],
		});
		sessionId.current = childId;
		setViewingChildSession(childId);

		restoreSessionHistory(
			childId,
			childData.model,
			childData.provider || childData.model.split('/')[0],
			childData.agent || 'build',
			customProviders,
			childData.thinkingEffort || undefined,
			childData.messages as unknown as Message[],
		).catch(() => {});

		securityRef.current?.getReadTracker().reset();
		securityRef.current?.getDoomLoop().reset();
		setTerminalTitle(formatSessionTitle(childData.title));
	}, [sessionState, sessionStore, sessionId, restoreSessionHistory, customProviders, securityRef]);

	const exitChildView = useCallback(() => {
		const parentId = parentSessionIdRef.current;
		if (parentId) {
			sessionState.switchSession(parentId);
			sessionId.current = parentId;
			const parentData = sessionStore.current.get(parentId);
			if (parentData) setTerminalTitle(formatSessionTitle(parentData.title));
		}
		parentSessionIdRef.current = null;
		setViewingChildSession(null);
		securityRef.current?.getReadTracker().reset();
		securityRef.current?.getDoomLoop().reset();
	}, [sessionState, sessionStore, sessionId, securityRef]);

	const handleViewChildSession = useCallback((childSessionId: string) => {
		parentSessionIdRef.current = sessionId.current;
		switchToChildSession(childSessionId);
	}, [switchToChildSession, sessionId]);

	// ─── Child view keyboard navigation ───
	useKeyboard(
		(key) => {
			if (!viewingChildSession) return;
			if (askRequest || dialogStep || updateVersion || msgControls || permissionRequest || showCmd) return;
			if (key.name === 'escape') {
				if (isStreamingRef.current) return;
				exitChildView();
				return;
			}
			if (key.name === 'p') {
				const child = sessionStore.current.get(viewingChildSession);
				if (!child?.parentId) return;
				const parent = sessionStore.current.getParent(viewingChildSession);
				if (!parent) return;
				if (parent.parentId) {
					parentSessionIdRef.current = parent.parentId;
					switchToChildSession(parent.id);
				} else {
					parentSessionIdRef.current = null;
					sessionState.switchSession(parent.id);
					sessionId.current = parent.id;
					setViewingChildSession(null);
					setTerminalTitle(formatSessionTitle(parent.title));
				}
				return;
			}
			if (key.name === '[') {
				const child = sessionStore.current.get(viewingChildSession);
				const parent = child?.parentId ? sessionStore.current.getParent(viewingChildSession) : null;
				if (parent) {
					const siblings = sessionStore.current.getChildren(parent.id);
					const idx = siblings.findIndex((s) => s.id === viewingChildSession);
					if (idx > 0) switchToChildSession(siblings[idx - 1].id);
				}
				return;
			}
			if (key.name === ']') {
				const child = sessionStore.current.get(viewingChildSession);
				const parent = child?.parentId ? sessionStore.current.getParent(viewingChildSession) : null;
				if (parent) {
					const siblings = sessionStore.current.getChildren(parent.id);
					const idx = siblings.findIndex((s) => s.id === viewingChildSession);
					if (idx >= 0 && idx < siblings.length - 1) switchToChildSession(siblings[idx + 1].id);
				}
				return;
			}
		},
	);

	// --- cmdFiltered + slash ---
	const paletteEntries = useMemo(() => orderPaletteCommands(resolvedEntries), [resolvedEntries]);
	const cmdFiltered = useMemo(() => {
		const q = cmdFilter.toLowerCase();
		return !q
			? paletteEntries
			: paletteEntries.filter(
					(r) =>
						r.definition.title.toLowerCase().includes(q) ||
						r.definition.description.toLowerCase().includes(q) ||
						(r.definition.category && r.definition.category.toLowerCase().includes(q)),
				);
	}, [paletteEntries, cmdFilter]);

	const slashFiltered = useMemo(() => {
		const head = slashHead(draftText);
		if (!head) return [] as ResolvedCommand[];
		const q = head.name.toLowerCase();
		if (!q) return resolvedEntries;
		return resolvedEntries.filter((resolved) => {
			const definition = resolved.definition;
			if (resolved.invocation.toLowerCase().includes(q)) return true;
			return definition.aliases.some((alias) => alias.toLowerCase().includes(q));
		});
	}, [resolvedEntries, draftText]);

	const normalizeArgCompletion = useCallback((item: string | ArgCompletion): ArgCompletion => {
		return typeof item === 'string' ? { value: item } : item;
	}, []);

	const [slashArgItems, setSlashArgItems] = useState<ArgCompletion[]>([]);

	useEffect(() => {
		let cancelled = false;
		const head = slashHead(draftText);
		const hasArgumentInput = head !== undefined && draftText.length > head.end;
		if (!head || !hasArgumentInput) {
			setSlashArgItems([]);
			return;
		}
		const matched = commandRegistry.resolve(head.name);
		const completer = matched?.definition.argCompleter;
		if (!completer) {
			setSlashArgItems([]);
			return;
		}
		const result = completer(head.arguments);
		Promise.resolve(result).then((items) => {
			if (!cancelled) setSlashArgItems(items.map(normalizeArgCompletion));
		});
		return () => { cancelled = true; };
	}, [commandRegistry, draftText, normalizeArgCompletion]);

	const currentSlashHead = slashHead(draftText);
	const hasSlashArgumentInput = currentSlashHead !== undefined && draftText.length > currentSlashHead.end;
	const slashArgActive = hasSlashArgumentInput && slashArgItems.length > 0;

	const slashActive = currentSlashHead !== undefined && !hasSlashArgumentInput;
	const fileAtActive = useMemo(() => /(^|\s)@([^\s]*)$/.test(draftText), [draftText]);
	useEffect(() => {
		setSlashSelected(0);
		setSlashArgSelected(0);
	}, [draftText]);
	useEffect(() => {
		if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1);
	}, [cmdSelected, cmdFiltered.length]);

	const execCmd = useCallback(
		(item: ResolvedCommand) => {
			void executeResolvedCommand(item, { source: 'palette', args: '' });
			setShowCmd(false);
		},
		[executeResolvedCommand, setShowCmd],
	);

	// --- Keyboard ---
	useAppKeyboard({
		renderer,
		isStreamingRef,
		currentTurnStartRef,
		currentTurnMsgIdRef,
		revertPoint,
		revertedMessagesRef,
		runRedo,
		dialogStep,
		askRequest,
		updateVersion,
		msgControls,
		permissionRequest,
		dialogKeyHandler,
		showCmd,
		cmdFilter,
		cmdSelected,
		cmdFiltered,
		draftText,
		slashActive,
		slashFiltered,
		slashSelected,
		slashArgItems,
		slashArgActive,
		slashArgSelected,
		fileAtActive,
		promptHistoryService,
		interruptKey,
		selectedAgent,
		primaryAgents: agentCatalog.primary,
		thinkingEffort,
		provider,
		securityRef,
		promptBarRef,
		sessionId,
		abortSession,
		promptTextareaRef,
		setShowCmd,
		setCmdFilter,
		setCmdSelected,
		setDraftText,
		setSlashSelected,
		setSlashArgSelected,
		setNavKey,
		setInterruptKey,
		setSelectedAgent,
		setMessages,
		setStatus,
		setThinkingEffort,
		updateMessage,
		updateLastAssistantMeta,
		execCmd,
		handleCycleVariant,
	});

	// --- JSX ---

	return (
		<box flexDirection="column" height={termHeight} backgroundColor={c.bg}>
			{route === 'home' ? (
				<box key={`home-${homeKey}`} flexDirection="column" flexGrow={1}>
					<box flexGrow={1} />
					<box flexDirection="column" alignItems="center" flexShrink={0}>
						<HomeTitle />
						<box height={1} />
						<PromptBar
							isLoading={isLoading}
							inputKey={`h-${submitKey}-${navKey}`}
							placeholder={`Ask anything... "${PLACEHOLDERS[placeholderIdx]}"`}
							onSubmit={handleSubmit}
							hasModel={hasModel}
							agent={selectedAgent}
							accentColor={agentAccentColor}
							model={selectedModel || ''}
							provider={provider || ''}
							thinkingEffort={thinkingEffort}
							initialValue={revertDraftRef.current || ''}
							width={Math.min(68, termWidth - 8)}
							focused={!dialogStep && !askRequest && !showCmd && !msgControls && !permissionRequest}
							onTextChange={(t) => setDraftText(t)}
							onGetTextarea={(r) => {
								promptTextareaRef.current = r;
							}}
							onPositionChange={setPromptPosition}
							onGetPromptBar={(r) => { promptBarRef.current = r; }}
						/>
						{(status === 'Error' || status === 'Interrupted') && (
							<ActivityFooter width={Math.max(0, Math.min(32, termWidth - 8))}
								isLoading={isLoading} status={status} permissionPending={!!permissionRequest}
								questionPending={!!askRequest} interruptArmed={interruptKey === 1}
								runningTools={0} spinner={SPINNER[spinnerFrame]} metrics="" />
						)}
						<box height={1} />
						<box flexDirection="row" justifyContent="flex-end" width={Math.min(68, termWidth - 8)}>
							<box flexDirection="row" gap={2}>
								<box flexDirection="row">
									<text fg={c.text}>tab</text>
									<text fg={c.dim}> agent</text>
								</box>
								<box flexDirection="row">
									<text fg={c.text}>ctrl+t</text>
									<text fg={c.dim}> effort</text>
								</box>
								<box flexDirection="row">
									<text fg={c.text}>ctrl+p</text>
									<text fg={c.dim}> commands</text>
								</box>
							</box>
						</box>
						<box height={1} />
						<box flexDirection="row" gap={4} alignItems="center">
							{[
								{ icon: '◈', label: `${sessionStore.current.list(process.cwd()).length} sessions` },
								{ icon: '◉', label: `${agentCatalog.primary.length} agents` },
								{ icon: '◆', label: '7 tools' },
								{ icon: '⬢', label: `${mcpCount} MCP` },
							].map((s) => (
								<box key={s.label} flexDirection="row" gap={1} alignItems="center">
									<text fg={c.accent}>{s.icon}</text>
									<text fg={c.dim}>{s.label}</text>
								</box>
							))}
						</box>
						<Tips />
					</box>
					<box flexGrow={1} />
					<box
						flexDirection="row"
						justifyContent="space-between"
						paddingLeft={2}
						paddingRight={2}
						height={1}
						marginBottom={1}
					>
						<box flexDirection="row" gap={4}>
							<text fg={c.dim} overflow="hidden" wrapMode="none">
								{cwdLabel}
							</text>
						</box>
						<box flexDirection="row" gap={1} alignItems="center">
							<text fg={c.dim}>Spectra Code</text>
							<text fg={c.dim}>v{APP_VERSION}</text>
						</box>
					</box>
				</box>
			) : (
				<box flexDirection="column" height={termHeight} paddingLeft={2} paddingRight={2}>
					{revertPoint && (
						<box flexDirection="column" alignItems="center" paddingY={1}>
							<box flexDirection="row">
								<text fg={c.warn}>Messages reverted. </text>
								<text fg={c.accent}>Ctrl+Y</text>
								<text fg={c.dim}> to redo (messages + files)</text>
							</box>
						</box>
					)}
					<box flexDirection="column" flexGrow={1} paddingBottom={1}>
						<ChatArea
							messages={messages}
							showThinking={showThinking}
							showToolCalls={showToolCalls}
							revertPoint={revertPoint}
							onMessageClick={(msg) => setMsgControls(msg)}
							onTaskClick={handleViewChildSession}
						/>
					</box>
						<PendingQueue
							steering={pendingSteering}
							followUp={pendingFollowUp}
							width={termWidth - 6}
						/>
						<box flexShrink={0}>
							{viewingChildSession ? (
								<SubagentNav
									childSessionId={viewingChildSession}
									sessionStore={sessionStore.current}
								/>
							) : (
								
							<PromptBar
								isLoading={isLoading}
								inputKey={`c-${submitKey}-${navKey}`}
								placeholder={'Reply...'}
								onSubmit={handleSubmit}
								hasModel={hasModel}
								agent={selectedAgent}
								accentColor={agentAccentColor}
								model={selectedModel || ''}
								provider={provider || ''}
								thinkingEffort={thinkingEffort}
								initialValue={revertDraftRef.current || ''}
								elapsedMs={elapsedMs}
								tokenUsage={tokenUsage}
								width={termWidth - 4}
								focused={!dialogStep && !askRequest && !showCmd && !msgControls && !permissionRequest}
								onTextChange={(t) => setDraftText(t)}
								onGetTextarea={(r) => {
									promptTextareaRef.current = r;
								}}
								onPositionChange={setPromptPosition}
								onGetPromptBar={(r) => { promptBarRef.current = r; }}
							/>
							
						)}
						<box height={1} />
						<ActivityFooter
							width={Math.max(0, termWidth - 4)}
							isLoading={isLoading}
							status={status}
							pendingSteering={pendingSteering.length}
							permissionPending={!!permissionRequest}
							questionPending={!!askRequest}
							interruptArmed={interruptKey === 1}
							runningTools={messages.filter((message) => message.role === 'tool' && message.streaming && message.toolExecutionStarted).length}
							spinner={SPINNER[spinnerFrame]}
							metrics={(() => {
								const used = contextBreakdown?.usedTokens ?? tokenUsage.input;
								if (used <= 0) return '';
								const window = contextBreakdown?.contextWindow || lookupContextWindow(selectedModel || '', provider);
								return [fmtCtx(used), window ? `(${Math.round(used / window * 100)}%)` : '', costDisplay].filter(Boolean).join(' ');
							})()}
						/>
					</box>
				</box>
			)}
			{showCmd && (
				<CommandPalette
					filter={cmdFilter}
					selected={cmdSelected}
					items={cmdFiltered}
					termWidth={termWidth}
					termHeight={termHeight}
				/>
			)}
			{!askRequest && slashActive && slashFiltered.length > 0 && (
				<SlashAutocomplete
					query={slashHead(draftText)?.name || ''}
					selected={slashSelected}
					items={slashFiltered}
					termWidth={termWidth}
					termHeight={termHeight}
					route={route}
					promptTop={promptPosition.top}
					promptLeft={promptPosition.left}
					promptWidth={promptPosition.width}
				/>
			)}
			{!askRequest && slashArgActive && (
				<ArgAutocomplete
					commandName={slashHead(draftText)?.name || ''}
					query={slashHead(draftText)?.arguments || ''}
					selected={slashArgSelected}
					items={slashArgItems}
					termWidth={termWidth}
					termHeight={termHeight}
					route={route}
					promptTop={promptPosition.top}
					promptLeft={promptPosition.left}
					promptWidth={promptPosition.width}
				/>
			)}
			{!askRequest && fileAtActive && (
				<FileAutocomplete
					draftText={draftText}
					promptTop={promptPosition.top}
					promptLeft={promptPosition.left}
					promptWidth={promptPosition.width}
					termWidth={termWidth}
					termHeight={termHeight}
					route={route}
					promptBarRef={promptBarRef}
				/>
			)}
			{dialogStep?.type === 'provider' && (
				<ProviderDialog
					termWidth={termWidth}
					termHeight={termHeight}
					keyHandlerRef={dialogKeyHandler}
					onModelSelected={(modelId, providerId) => {
						setSelectedModel(modelId);
						setSelectedProvider(providerId);
						setSavedConfig({ model: modelId, provider: providerId });
						setDialogStep(null);
						saveModelConfig(modelId, providerId);
						showToast(`Model set`, 'success');
					}}
					onClose={() => setDialogStep(null)}
				/>
			)}
			{dialogStep?.type === 'session-list' && (
				<SessionList
					store={sessionStore.current}
					termWidth={termWidth}
					termHeight={termHeight}
					mode={dialogStep.mode || 'load'}
					onLoad={(data) => {
						const { messages: loadedMsgs, tokenUsage: tu, costSoFar } = sdkMessagesToChatMessages(data);
						const restoredContext = restoreLatestContextSnapshot(sessionStore.current.get(data.id)?.messages ?? []);
						// Switch to the session's per-session state
						sessionState.switchSession(data.id);
						sessionState.set(data.id, {
							messages: loadedMsgs,
							tokenUsage: tu,
							costSoFar,
							contextUsage: restoredContext,
							selectedModel: data.model,
							selectedProvider: data.provider || data.model.split('/')[0],
							selectedAgent: data.agent || 'build',
							thinkingEffort: data.thinkingEffort || undefined,
							pendingSteering: [],
							pendingFollowUp: [],
						});
						sessionId.current = data.id;
						setRoute('chat');
						setDialogStep(null);
						// Restore this session's agent history (per-session Map — doesn't affect other sessions)
						restoreSessionHistory(
							data.id,
							data.model,
							data.provider || data.model.split('/')[0],
							data.agent || 'build',
							customProviders,
							data.thinkingEffort || undefined,
							data.messages as unknown as Message[],
						).catch(() => {});
						securityRef.current?.getReadTracker().reset();
						securityRef.current?.getDoomLoop().reset();
						showToast(`Loaded: ${data.title.slice(0, 40)}`, 'info');
						setTerminalTitle(formatSessionTitle(data.title));
					}}
					onDelete={(id) => {
						sessionStore.current.delete(id);
						removeSessionAgent(id);
					if (sessionId.current === id) {
						sessionId.current = null;
						sessionState.switchSession(null);
						setRoute('home');
						setHomeKey((k) => k + 1);
						setTerminalTitle('Spectra');
						setDialogStep(null);
					}
						showToast('Session deleted', 'success');
					}}
					onRename={(id, title) => {
						sessionStore.current.rename(id, title);
						showToast('Session renamed', 'success');
					}}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'switch-model' && (
				<ModelSwitcher
					providerId={provider || ''}
					termWidth={termWidth}
					termHeight={termHeight}
					onModelSelected={(modelId, providerId) => {
						setSelectedModel(modelId);
						setSelectedProvider(providerId);
						setSavedConfig({ model: modelId, provider: providerId });
						setDialogStep(null);
						saveModelConfig(modelId, providerId);
						showToast(`Switched model`, 'info');
					}}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'manage-providers' && (
				<ManageProvidersDialog
					termWidth={termWidth}
					termHeight={termHeight}
					providers={customProviders}
					onProvidersChange={(updated) => {
						setCustomProviders(updated);
						showToast('Providers updated', 'success');
					}}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'doctor' && dialogStep.result && (
				<DoctorDialog
					result={dialogStep.result}
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'about' && (
				<AboutDialog
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{updateVersion && (
				<UpdateDialog
					newVersion={updateVersion}
					currentVersion={VERSION}
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setUpdateVersion(null)}
					onInstall={() => {
						try {
							clipboard.writeSync(UPDATE_COMMAND);
							showToast('Command copied to clipboard', 'success');
						} catch {}
						setUpdateVersion(null);
					}}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'switch-agent' && (
				<AgentSwitcher
					currentAgent={selectedAgent}
					primaryAgents={agentCatalog.primary}
					definitions={agentCatalog.definitions}
					termWidth={termWidth}
					termHeight={termHeight}
					onAgentSelected={(agent) => {
						setSelectedAgent(agent);
						setDialogStep(null);
						showToast(`Switched to ${titlecase(agent)} agent`, 'info');
					}}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'thinking-effort' && (
				<ThinkingEffortDialog
					provider={provider}
					currentEffort={thinkingEffort}
					termWidth={termWidth}
					termHeight={termHeight}
					onEffortSelected={(effort) => {
						setThinkingEffort(effort);
						setDialogStep(null);
						showToast(effort === 'none' ? 'Thinking: off' : `Thinking: ${effort}`, 'info');
					}}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'toggle-mcp' && (
				<McpToggleDialog
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'debug' && (
				<DebugDialog
					termWidth={termWidth}
					termHeight={termHeight}
					selectedModel={selectedModel}
					provider={provider}
					selectedAgent={selectedAgent}
					thinkingEffort={thinkingEffort}
					sessionStore={sessionStore.current}
					mcpCount={mcpCount}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'session-stats' && (
				<SessionStatsDialog
					termWidth={termWidth}
					termHeight={termHeight}
					selectedModel={selectedModel}
					provider={provider}
					selectedAgent={selectedAgent}
					thinkingEffort={thinkingEffort}
					mcpCount={mcpCount}
					customProviderCount={customProviderCount}
					turnCount={turnCount}
					messagesLength={messages.length}
					elapsedMs={elapsedMs}
					tokPerSec={tokPerSec}
					contextTokens={contextBreakdown?.usedTokens ?? tokenUsage.input}
					sessionTokens={sessionTokens}
					costSoFar={sessionState.activeState.costSoFar}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'context-usage' && (
				<ContextUsageDialog
					breakdown={contextBreakdown}
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'usage' && (
				<UsageDialog
					termWidth={termWidth}
					termHeight={termHeight}
					activeProvider={provider}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'memory' && (
				<MemoryDialog
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'settings' && (
				<SettingsDialog
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{dialogStep?.type === 'skills' && (
				<SkillsDialog
					defaultTab={dialogStep.defaultTab}
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{msgControls && sessionId.current && (
				<MessageControls
					message={msgControls}
					sessionId={sessionId.current}
					messages={messages}
					termWidth={termWidth}
					termHeight={termHeight}
					revertPoint={revertPoint}
					onRevert={(msgId) => {
						runRevert(messages, msgId);
						setMsgControls(null);
					}}
					onRedo={() => {
						runRedo();
						setMsgControls(null);
					}}
					onFork={(msgId) => {
						const forked = sessionStore.current.fork(sessionId.current!);
						if (forked) {
							const msgIdx = messages.findIndex((m) => m.id === msgId);
							if (msgIdx >= 0) {
								forked.messages = forked.messages.slice(0, msgIdx + 1);
								forked.title = `${forked.title.split(' (fork)')[0]} (fork)`;
								sessionStore.current.save(forked);
							}
							const data = sessionStore.current.get(forked.id);
							if (data) {
								const { messages: loadedMsgs } = sdkMessagesToChatMessages(data);
								const restoredContext = restoreLatestContextSnapshot(data.messages);
								sessionState.switchSession(data.id);
								sessionState.set(data.id, { messages: loadedMsgs, contextUsage: restoredContext, pendingSteering: [], pendingFollowUp: [] });
								sessionId.current = forked.id;
								showToast('Session forked', 'success');
							}
						}
						setMsgControls(null);
					}}
					onClose={() => setMsgControls(null)}
					registerHandler={(fn) => {
						dialogKeyHandler.current = fn;
					}}
				/>
			)}
			{permissionRequest && (
				<PermissionDialog
					key={permissionRequest.id}
					request={permissionRequest}
					termWidth={termWidth}
					termHeight={termHeight}
					onAllow={(id) => {
						resolvePermission(id, { action: 'once' });
					}}
					onAllowAlways={(id) => {
						resolvePermission(id, { action: 'always' });
					}}
					onDeny={(id) => {
						resolvePermission(id, { action: 'deny' });
					}}
					onClose={() => {
						resolvePermission(permissionRequest!.id, { action: 'deny' });
					}}
				/>
			)}
			{askRequest && (
				<AskMenu
					input={askRequest}
					termWidth={termWidth}
					termHeight={termHeight}
					route={route}
					promptTop={promptPosition.top}
					promptLeft={promptPosition.left}
					promptWidth={promptPosition.width}
					onSubmit={settleAsk}
					onCancel={() => settleAsk(undefined)}
					registerHandler={(handler) => {
						dialogKeyHandler.current = handler;
					}}
				/>
			)}
			<ToastContainer />
		</box>
	);
}
