import { useRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTerminalDimensions } from '@opentui/react';
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
import { MessageControls } from './ui/message-controls.js';
import { ToastContainer, showToast } from './components/toast.js';
import clipboard from 'clipboardy';
import { loadPricingFromModelsDev, calculateCost, formatCost, isFreeModel } from '@mohanscodex/spectra-ai';
import { buildCmdItems, collectSlashNames } from './commands.js';
import { slashHead } from './slash-commands.js';
import { SlashAutocomplete } from './components/slash-autocomplete.js';
import { checkForUpdate } from './utils/update-check.js';
import { VERSION } from './utils/version.js';
import { loadConfig, type CustomProviderConfig } from '../services/config.js';
import { registerAllCustomProviders } from '../services/custom-providers.js';
import { PermissionDialog } from './ui/permission-dialog.js';
import { AGENTS, PLACEHOLDERS } from './app-constants.js';

import { loadSavedConfig, saveModelConfig, fmtCtx, lookupContextWindow } from './utils/model-config.js';
import { sdkMessagesToChatMessages } from './utils/session-messages.js';
import { usePermissionQueue } from './hooks/use-permission-queue.js';
import { useRevert } from './hooks/use-revert.js';
import { useAgent } from './hooks/use-agent.js';
import { useChatSubmit } from './hooks/use-chat-submit.js';
import { useAppKeyboard } from './hooks/use-app-keyboard.js';
import { cycleEffort } from './variant-cycle.js';
import type { SecurityManager } from '../security/index.js';

export function App({ renderer }: { renderer: CliRenderer }) {
	const { width: termWidth, height: termHeight } = useTerminalDimensions();

	// --- State ---
	const [savedConfig] = useState(loadSavedConfig);
	const [customProviders, setCustomProviders] = useState<Record<string, CustomProviderConfig>>(() => {
		const cfg = loadConfig();
		const cp = cfg.providers || {};
		registerAllCustomProviders(cp);
		return cp;
	});
	const [selectedModel, setSelectedModel] = useState<string | null>(savedConfig.model);
	const [selectedProvider, setSelectedProvider] = useState<string | null>(savedConfig.provider);
	const [thinkingEffort, setThinkingEffort] = useState<string | undefined>(undefined);
	const [route, setRoute] = useState<'home' | 'chat'>('home');
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [status, setStatus] = useState('Ready');
	const [spinnerFrame, setSpinnerFrame] = useState(0);
	const [showCmd, setShowCmd] = useState(false);
	const [cmdFilter, setCmdFilter] = useState('');
	const [cmdSelected, setCmdSelected] = useState(0);
	const [elapsedMs, setElapsedMs] = useState<number | null>(null);
	const [tokPerSec, setTokPerSec] = useState<number | null>(null);
	const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 });
	const [showThinking, setShowThinking] = useState(true);
	const [showToolCalls, setShowToolCalls] = useState(true);
	const [copiedMsg, setCopiedMsg] = useState(false);
	const [selectedAgent, setSelectedAgent] = useState('build');
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

	const costDisplay = useMemo(() => {
		const total = tokenUsage.input + tokenUsage.output;
		if (total === 0 || !selectedModel) return null;
		if (isFreeModel(selectedModel)) return 'Free';
		const cost = calculateCost(selectedModel, tokenUsage);
		return cost.total > 0 ? formatCost(cost.total) : null;
	}, [tokenUsage, selectedModel]);

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
					setCopiedMsg(true);
					setTimeout(() => setCopiedMsg(false), 2500);
				} catch {}
			}, 2000);
		};
		renderer.on('selection', handler);
		return () => {
			renderer.off?.('selection', handler);
		};
	}, [renderer]);

	// --- Stable callbacks ---
	const addMessage = useCallback((msg: ChatMessage) => setMessages((p) => [...p, msg]), []);
	const updateMessage = useCallback(
		(id: string, u: Partial<ChatMessage>) => setMessages((p) => p.map((m) => (m.id === id ? { ...m, ...u } : m))),
		[],
	);

	// --- Hooks (order matters for ref lifecycle) ---
	const securityRef = useRef<SecurityManager | null>(null);

	const { permissionRequest, enqueuePermission, resolvePermission } = usePermissionQueue(securityRef);

	const { agentRef, loadedSessionMessages, getOrCreateAgent, resetAgentForModelSwitch } = useAgent({
		securityRef,
		securityConfig,
		enqueuePermission,
	});

	const { revertedMessagesRef, revertDraftRef, runRevert, runRedo, discardRevert } = useRevert({
		sessionStore,
		sessionId,
		agentRef,
		loadedSessionMessages,
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
		agentRef.current = null;
		showToast(nextEffort === 'none' ? 'Thinking: off' : `Thinking: ${nextEffort}`, 'info');
	}, [provider, thinkingEffort, agentRef]);

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
		sessionId,
		agentRef,
		securityRef,
		loadedSessionMessages,
		snapshotManager,
		lastAgentRef: useRef(null),
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
		addMessage,
		updateMessage,
		setMessages,
		setIsLoading,
		setStatus,
		setRoute,
		setElapsedMs,
		setTokPerSec,
		setTokenUsage,
		setDraftText,
		setSlashSelected,
		setSubmitKey,
		setInterruptKey,
		setRevertPoint,
		discardRevert,
		promptHistoryService,
	});

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
		agentRef,
		securityRef,
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
					<box flexDirection="column" flexGrow={1} paddingBottom={1}>
						<ChatArea
							messages={messages}
							showThinking={showThinking}
							showToolCalls={showToolCalls}
							revertPoint={revertPoint}
							onMessageClick={(msg) => setMsgControls(msg)}
						/>
					</box>
					<box flexShrink={0}>
						<PromptBar
							isLoading={isLoading}
							spinnerFrame={spinnerFrame}
							inputKey={`c-${submitKey}-${navKey}`}
							placeholder="Reply..."
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
											<text fg={c.accent}>esc</text>
											<text fg={c.dim}>interrupt</text>
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
						const { messages: loadedMsgs, tokenUsage: tu } = sdkMessagesToChatMessages(data);
						setTokenUsage(tu);
						setMessages(() => loadedMsgs);
						sessionId.current = data.id;
						setSelectedModel(data.model);
						setSelectedProvider(data.provider || data.model.split('/')[0]);
						setSelectedAgent(data.agent);
						setThinkingEffort(data.thinkingEffort || undefined);
						setRoute('chat');
						setDialogStep(null);
						loadedSessionMessages.current = data.messages as unknown as Message[];
						if (agentRef.current) {
							agentRef.current.reset();
							agentRef.current.restoreHistory(data.messages as unknown as Message[]);
						}
						securityRef.current?.getReadTracker().reset();
						securityRef.current?.getDoomLoop().reset();
						showToast(`Loaded: ${data.title.slice(0, 40)}`, 'info');
					}}
					onDelete={(id) => {
						sessionStore.current.delete(id);
						if (sessionId.current === id) {
							sessionId.current = null;
							setMessages([]);
							setRoute('home');
							setHomeKey((k) => k + 1);
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
								setMessages(loadedMsgs);
								sessionId.current = forked.id;
								loadedSessionMessages.current = data.messages as unknown as Message[];
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
