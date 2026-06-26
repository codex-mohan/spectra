import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTerminalDimensions, useKeyboard } from '@opentui/react';
import type { CliRenderer } from '@opentui/core';
import { execFileSync } from 'child_process';
import { c, SPINNER } from './theme.js';
import { ChatArea } from './components/chat-area.js';
import { CommandPalette } from './components/command-palette.js';
import { PromptBar } from './prompt-bar.js';
import { Tips } from './tips.js';
import { titlecase } from './utils.js';
import type { ChatMessage } from './types.js';
import { SessionStore } from '../services/session-store.js';
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
import { UpdateDialog } from './ui/update-dialog.js';
import { CostDialog } from './ui/cost-dialog.js';
import { MemoryDialog } from './ui/memory-dialog.js';
import { SettingsDialog } from './ui/settings-dialog.js';
import { SkillsDialog } from './ui/skills-dialog.js';
import { MessageControls } from './ui/message-controls.js';
import { ToastContainer, showToast } from './components/toast.js';
import { SubagentFooter } from './components/subagent-footer.js';
import clipboard from 'clipboardy';
import { loadPricingFromModelsDev, formatCost, isFreeModel } from '@mohanscodex/spectra-ai';
import { buildCmdItems, collectSlashNames } from './commands.js';
import { slashHead } from './slash-commands.js';
import { SlashAutocomplete } from './components/slash-autocomplete.js';
import { checkForUpdate } from './utils/update-check.js';
import { VERSION } from './utils/version.js';
import { setTerminalTitle, formatSessionTitle } from './utils/terminal-title.js';
import { loadConfig, type CustomProviderConfig } from '../services/config.js';
import { registerAllCustomProviders } from '../services/custom-providers.js';
import { PermissionDialog } from './ui/permission-dialog.js';
import { AGENTS, PLACEHOLDERS } from './app-constants.js';

import { loadSavedConfig, saveModelConfig, fmtCtx, lookupContextWindow } from './utils/model-config.js';
import { sdkMessagesToChatMessages } from './utils/session-messages.js';
import { usePermissionQueue } from './hooks/use-permission-queue.js';
import { useRevert } from './hooks/use-revert.js';
import { useAgent, createSessionFactory, createSessionSecurityManager } from './hooks/use-agent.js';
import { useChatSubmit } from './hooks/use-chat-submit.js';
import { useAppKeyboard } from './hooks/use-app-keyboard.js';
import { useSessionState } from './hooks/use-session-state.js';
import { cycleEffort } from './variant-cycle.js';
import type { SecurityManager } from '../security/index.js';
import { backgroundTasks } from '../services/background-tasks.js';

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
	const [updateVersion, setUpdateVersion] = useState<string | null>(null);
	const [placeholderIdx, setPlaceholderIdx] = useState(0);
	const [navKey, setNavKey] = useState(0);
	const [homeKey, setHomeKey] = useState(0);
	const [interruptKey, setInterruptKey] = useState(0);
	const [msgControls, setMsgControls] = useState<ChatMessage | null>(null);
	const [revertPoint, setRevertPoint] = useState<string | null>(null);
	const [draftText, setDraftText] = useState('');
	const [slashSelected, setSlashSelected] = useState(0);
	const [promptPosition, setPromptPosition] = useState({ top: 0, left: 0, width: 0 });

	// Child session view-switching state (Phase 1)
	const [viewingChildSession, setViewingChildSession] = useState<string | null>(null);
	const parentSessionIdRef = useRef<string | null>(null);

	// Per-session state
	const sessionState = useSessionState();
	const messages = sessionState.activeState.messages;
	const isLoading = sessionState.activeState.isLoading;
	const status = sessionState.activeState.status;
	const tokenUsage = sessionState.activeState.tokenUsage;
	const elapsedMs = sessionState.activeState.elapsedMs;
	const tokPerSec = sessionState.activeState.tokPerSec;
	const selectedAgent = sessionState.activeState.selectedAgent;
	const selectedModel = sessionState.activeState.selectedModel ?? savedConfig.model;
	const selectedProvider = sessionState.activeState.selectedProvider ?? savedConfig.provider;
	const thinkingEffort = sessionState.activeState.thinkingEffort;

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
		sessionState.setActive({ selectedAgent: resolved });
	};
	const setSelectedModel = (v: string | null | ((prev: string | null) => string | null)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.selectedModel) : v;
		sessionState.setActive({ selectedModel: resolved });
	};
	const setSelectedProvider = (v: string | null | ((prev: string | null) => string | null)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.selectedProvider) : v;
		sessionState.setActive({ selectedProvider: resolved });
	};
	const setThinkingEffort = (v: string | undefined | ((prev: string | undefined) => string | undefined)) => {
		const current = sessionState.getState(sessionState.activeSessionId);
		const resolved = typeof v === 'function' ? v(current.thinkingEffort) : v;
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
	const promptTextareaRef = useRef<any>(null);
	const sessionStore = useRef(new SessionStore());
	const sessionId = useRef<string | null>(null);
	const dialogKeyHandler = useRef<((key: any) => void) | null>(null);
	const isStreamingRef = useRef(false);
	const currentTurnStartRef = useRef<number | null>(null);
	const currentTurnMsgIdRef = useRef<string | null>(null);
	const snapshotManager = useRef(new SnapshotManager({ workdir: process.cwd() }));
	const promptHistoryService = useRef(new PromptHistoryService());

	const [securityConfig] = useState(() => {
		const cfg = loadConfig();
		return { permission: cfg.permission, security: cfg.security };
	});

	const sessionManager = useRef<SessionManager>(
		new SessionManager(
			sessionStore.current,
			createSessionFactory(securityConfig, () => {}),
			() => createSessionSecurityManager(securityConfig, () => {}),
		),
	);

	// --- Derived ---
	const provider = selectedProvider;
	const hasModel = selectedModel !== null && selectedProvider !== null;
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

	const { agentsMapRef, lastAgentRef, getOrCreateAgent, restoreSessionHistory, abortSession, removeSessionAgent, resetAgentForModelSwitch } = useAgent({
		securityRef,
		securityConfig,
		enqueuePermission,
		sessionStore,
		sessionId,
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
		resetAgentForModelSwitch();
		showToast(nextEffort === 'none' ? 'Thinking: off' : `Thinking: ${nextEffort}`, 'info');
	}, [provider, thinkingEffort, resetAgentForModelSwitch]);

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
				onCycleVariant: handleCycleVariant,
				currentEffort: thinkingEffort,
				selectedAgent,
				onSecurityReset: () => {
					securityRef.current?.getReadTracker().reset();
					securityRef.current?.getDoomLoop().reset();
				},
				tokenUsage,
				elapsedMs,
				tokPerSec,
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
			tokenUsage,
			elapsedMs,
			tokPerSec,
		],
	);

	const slashNames = useMemo(() => collectSlashNames(cmdItems), [cmdItems]);

	const { handleSubmit, updateLastAssistantMeta } = useChatSubmit({
		sessionStore,
		sessionManager,
		sessionState,
		switchSession: sessionState.switchSession,
		sessionId,
		securityRef,
		snapshotManager,
		lastAgentRef,
		isStreamingRef,
		currentTurnStartRef,
		currentTurnMsgIdRef,
		revertPoint,
		getOrCreateAgent,
		selectedModel,
		provider,
		selectedAgent,
		customProviders,
		thinkingEffort,
		cmdItems,
		slashNames,
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

		sessionState.switchSession(childId);
		sessionState.set(childId, {
			messages: childMsgs,
			tokenUsage: childTokens,
			costSoFar: childCost,
			selectedModel: childData.model,
			selectedProvider: childData.provider || childData.model.split('/')[0],
			selectedAgent: childData.agent || 'build',
			thinkingEffort: childData.thinkingEffort || undefined,
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
			if (dialogStep || updateVersion || msgControls || permissionRequest || showCmd) return;
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
	const cmdFiltered = useMemo(() => {
		const q = cmdFilter.toLowerCase();
		return !q
			? cmdItems
			: cmdItems.filter(
					(i) =>
						i.label.toLowerCase().includes(q) ||
						i.desc.toLowerCase().includes(q) ||
						(i.cat && i.cat.toLowerCase().includes(q)),
				);
	}, [cmdItems, cmdFilter]);

	const slashFiltered = useMemo(() => {
		const head = slashHead(draftText);
		if (!head) return [] as typeof cmdItems;
		const q = head.name.toLowerCase();
		if (!q) return cmdItems;
		return cmdItems.filter((item) => {
			if (item.slashName && item.slashName.toLowerCase().includes(q)) return true;
			if (item.slashAliases) return item.slashAliases.some((a) => a.toLowerCase().includes(q));
			return false;
		});
	}, [cmdItems, draftText]);

	const slashActive = useMemo(() => slashHead(draftText) !== undefined, [draftText]);
	useEffect(() => {
		setSlashSelected(0);
	}, [draftText]);
	useEffect(() => {
		if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1);
	}, [cmdSelected, cmdFiltered.length]);

	const execCmd = useCallback(
		(item: any) => {
			item.action();
			setShowCmd(false);
		},
		[setShowCmd],
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
		promptHistoryService,
		interruptKey,
		selectedAgent,
		thinkingEffort,
		provider,
		securityRef,
		sessionId,
		abortSession,
		promptTextareaRef,
		setShowCmd,
		setCmdFilter,
		setCmdSelected,
		setDraftText,
		setSlashSelected,
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
						<ascii-font text="SPECTRA" font="block" color={c.accent} />
						<box height={1} />
						<PromptBar
							isLoading={isLoading}
							spinnerFrame={spinnerFrame}
							inputKey={`h-${submitKey}-${navKey}`}
							placeholder={`Ask anything... "${PLACEHOLDERS[placeholderIdx]}"`}
							onSubmit={handleSubmit}
							hasModel={hasModel}
							agent={selectedAgent}
							model={selectedModel || ''}
							provider={provider || ''}
							thinkingEffort={thinkingEffort}
							initialValue={revertDraftRef.current || ''}
							width={Math.min(68, termWidth - 8)}
							focused={!dialogStep && !showCmd && !msgControls && !permissionRequest}
							onTextChange={(t) => setDraftText(t)}
							onGetTextarea={(r) => {
								promptTextareaRef.current = r;
							}}
							onPositionChange={setPromptPosition}
						/>
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
								{ icon: '◉', label: '3 agents' },
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
						<text fg={c.dim} flexShrink={0}>
							Spectra Code
						</text>
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
					{viewingChildSession && (
						<SubagentFooter
							childSessionId={viewingChildSession}
							sessionStore={sessionStore.current}
							onBack={exitChildView}
							onNavigate={switchToChildSession}
						/>
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
					<box flexShrink={0}>
						{viewingChildSession ? (
							<box
								flexDirection="row"
								gap={1}
								alignItems="center"
								height={3}
								backgroundColor={c.bgInput}
								border={['top', 'bottom']}
								borderColor={c.border}
								paddingLeft={3}
								paddingRight={2}
							>
								<text fg={c.dim}>◆</text>
								<text fg={c.subtext}>Read-only — press </text>
								<text fg={c.accent}>esc</text>
								<text fg={c.subtext}> to return</text>
							</box>
						) : (
							<PromptBar
								isLoading={isLoading}
								spinnerFrame={spinnerFrame}
								inputKey={`c-${submitKey}-${navKey}`}
								placeholder={'Reply...'}
								onSubmit={handleSubmit}
								hasModel={hasModel}
								agent={selectedAgent}
								model={selectedModel || ''}
								provider={provider || ''}
								thinkingEffort={thinkingEffort}
								initialValue={revertDraftRef.current || ''}
								elapsedMs={elapsedMs}
								tokenUsage={tokenUsage}
								width={termWidth - 4}
								focused={!dialogStep && !showCmd && !msgControls && !permissionRequest}
								onTextChange={(t) => setDraftText(t)}
								onGetTextarea={(r) => {
									promptTextareaRef.current = r;
								}}
								onPositionChange={setPromptPosition}
							/>
						)}
						<box height={1} />
						<box
							flexDirection="row"
							justifyContent="space-between"
							alignItems="center"
							height={1}
							paddingLeft={3}
							paddingRight={1}
						>
							<box flexDirection="row" gap={2} alignItems="center" overflow="hidden">
								{isLoading ? (
									<box flexDirection="row" gap={2} alignItems="center">
										<box flexDirection="row" gap={1}>
											<text fg={c.warn}>{SPINNER[spinnerFrame]}</text>
											<text fg={c.dim}>Streaming...</text>
										</box>
										<box flexDirection="row" gap={1}>
											<text fg={interruptKey === 1 ? c.warn : c.accent}>
												{interruptKey === 1 ? 'esc again' : 'esc'}
											</text>
											<text fg={c.dim}>{interruptKey === 1 ? 'confirm' : 'interrupt'}</text>
										</box>
									</box>
								) : (
									<text fg={c.dim}>Ready</text>
								)}
								{tokenUsage.input + tokenUsage.output > 0 &&
									(() => {
										const used = tokenUsage.input + tokenUsage.output;
										const cw = lookupContextWindow(selectedModel || '', provider);
										const pct = cw ? Math.round((used / cw) * 100) : null;
										return (
											<box flexDirection="row" gap={1}>
												<text fg={c.subtext}>{fmtCtx(used)}</text>
												{pct !== null && <text fg={pct > 80 ? c.warn : c.dim}>({pct}%)</text>}
												{costDisplay && <text fg={c.warn}>{costDisplay}</text>}
											</box>
										);
									})()}
							</box>
							<box flexDirection="row" gap={2} alignItems="center">
								{viewingChildSession && (
									<text fg={c.accent}>◆ read-only</text>
								)}
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
			{slashActive && slashFiltered.length > 0 && (
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
			{dialogStep?.type === 'provider' && (
				<ProviderDialog
					termWidth={termWidth}
					termHeight={termHeight}
					keyHandlerRef={dialogKeyHandler}
					onModelSelected={(modelId, providerId) => {
						resetAgentForModelSwitch();
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
						// Switch to the session's per-session state
						sessionState.switchSession(data.id);
						sessionState.set(data.id, {
							messages: loadedMsgs,
							tokenUsage: tu,
							costSoFar,
							selectedModel: data.model,
							selectedProvider: data.provider || data.model.split('/')[0],
							selectedAgent: data.agent || 'build',
							thinkingEffort: data.thinkingEffort || undefined,
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
						resetAgentForModelSwitch();
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
						resetAgentForModelSwitch();
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
							clipboard.writeSync('bun update -g @mohanscodex/spectra-code');
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
					termWidth={termWidth}
					termHeight={termHeight}
					onAgentSelected={(agent) => {
						setSelectedAgent(agent);
						resetAgentForModelSwitch();
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
						resetAgentForModelSwitch();
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
			{dialogStep?.type === 'cost' && (
				<CostDialog
					termWidth={termWidth}
					termHeight={termHeight}
					selectedModel={selectedModel || ''}
					provider={provider || ''}
					tokenUsage={tokenUsage}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
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
					termWidth={termWidth}
					termHeight={termHeight}
					onClose={() => setDialogStep(null)}
					registerHandler={(fn: any) => {
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
								sessionState.switchSession(data.id);
								sessionState.set(data.id, { messages: loadedMsgs });
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
			<ToastContainer />
		</box>
	);
}
