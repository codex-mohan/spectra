import { useRef, useCallback } from 'react';
import type { ChatMessage, ContentBlock } from '../types.js';
import type { Message, AssistantMessage } from '@mohanscodex/spectra-ai';
import type { SessionStore } from '../../services/session-store.js';
import type { SnapshotManager } from '../../services/snapshot-manager.js';
import type { Patch } from '../types.js';
import type { PromptHistoryService } from '../../services/prompt-history.js';
import { genId, getMessageBlocks } from '../utils.js';
import { AGENT_DEFINITIONS } from '../../agents/index.js';
import { parseSlashCommand } from '../slash-commands.js';
import { showToast } from '../components/toast.js';
import type { CmdItem } from '../components/command-palette.js';

interface UseChatSubmitDeps {
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionId: React.MutableRefObject<string | null>;
	agentRef: React.MutableRefObject<any>;
	securityRef: React.MutableRefObject<any>;
	loadedSessionMessages: React.MutableRefObject<Message[]>;
	snapshotManager: React.MutableRefObject<SnapshotManager>;
	lastAgentRef: React.MutableRefObject<string | null>;
	isStreamingRef: React.MutableRefObject<boolean>;
	currentTurnStartRef: React.MutableRefObject<number | null>;
	currentTurnMsgIdRef: React.MutableRefObject<string | null>;
	revertPoint: string | null;
	getOrCreateAgent: (
		model: string | null,
		provider: string | null,
		agent: string,
		customProviders: any,
		effort: string | undefined,
	) => Promise<any>;
	selectedModel: string | null;
	provider: string | null;
	selectedAgent: string;
	customProviders: Record<string, any>;
	thinkingEffort: string | undefined;
	cmdItems: CmdItem[];
	slashNames: Set<string>;
	addMessage: (msg: ChatMessage) => void;
	updateMessage: (id: string, u: Partial<ChatMessage>) => void;
	setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
	setIsLoading: (v: boolean) => void;
	setStatus: (s: string) => void;
	setRoute: (r: 'home' | 'chat') => void;
	setElapsedMs: (v: number | null) => void;
	setTokPerSec: (v: number | null) => void;
	setTokenUsage: (fn: (prev: { input: number; output: number }) => { input: number; output: number }) => void;
	setDraftText: (t: string) => void;
	setSlashSelected: (i: number) => void;
	setSubmitKey: (fn: (k: number) => number) => void;
	setInterruptKey: (k: number) => void;
	setRevertPoint: (id: string | null) => void;
	discardRevert: () => void;
	promptHistoryService: React.MutableRefObject<PromptHistoryService>;
}

export function useChatSubmit(deps: UseChatSubmitDeps) {
	const {
		sessionStore,
		sessionId,
		agentRef,
		securityRef,
		loadedSessionMessages,
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
	} = deps;

	const shownToolCalls = useRef(new Set<string>());
	const toolMsgMap = useRef(new Map<string, string>());
	const toolArgsMap = useRef(new Map<string, unknown>());
	const streamingIdRef = useRef<string | null>(null);
	const queuedMessageRef = useRef<string | null>(null);
	const preEditSnapshotRef = useRef<string | undefined>(undefined);

	function persistMessage(sdkMsg: Message) {
		if (!sessionId.current) return;
		sessionStore.current.addMessage(sessionId.current, sdkMsg);
	}

	function updateLastAssistantMeta(meta: Record<string, unknown>) {
		if (!sessionId.current) return;
		const sess = sessionStore.current.get(sessionId.current);
		if (!sess) return;
		for (let i = sess.messages.length - 1; i >= 0; i--) {
			const msg = sess.messages[i];
			if (msg.role === 'assistant') {
				msg.metadata = { ...msg.metadata, ...meta };
				sessionStore.current.save(sess);
				return;
			}
		}
	}

	const handleSubmit = useCallback(
		async (text: string) => {
			const trimmed = text.trim();
			if (!trimmed) return;
			if (isStreamingRef.current) {
				queuedMessageRef.current = trimmed;
				return;
			}

			const parsed = parseSlashCommand(trimmed, slashNames);
			if (parsed.type === 'command') {
				const cmd = cmdItems.find((item) => {
					if (item.slashName === parsed.command.name) return true;
					if (item.slashAliases?.includes(parsed.command.name)) return true;
					return false;
				});
				if (cmd) {
					cmd.action();
					setDraftText('');
					setSlashSelected(0);
					setSubmitKey((k) => k + 1);
					return;
				}
			}

			if (!selectedModel || !provider) {
				showToast('Connect a provider to send prompts', 'warn');
				return;
			}

			if (revertPoint !== null) {
				discardRevert();
			}

			setDraftText('');
			setSlashSelected(0);
			setSubmitKey((k) => k + 1);
			setTokPerSec(null);
			setElapsedMs(null);
			shownToolCalls.current.clear();
			toolMsgMap.current.clear();
			toolArgsMap.current.clear();
			promptHistoryService.current.append(trimmed);

			const uid = genId();
			const userMsg: Message = { role: 'user', content: trimmed, timestamp: Date.now() };
			addMessage({ id: uid, role: 'user', content: trimmed, model: selectedModel });
			setIsLoading(true);
			setStatus('Streaming...');
			setRoute('chat');
			isStreamingRef.current = true;
			streamingIdRef.current = 'pending';

			if (!sessionId.current) {
				agentRef.current = null;
				loadedSessionMessages.current = [];
				const sess = sessionStore.current.create({
					agent: selectedAgent,
					model: selectedModel,
					provider,
					thinkingEffort: thinkingEffort || undefined,
				});
				sess.title = `Session ${new Date().toISOString()}`;
				sessionStore.current.save(sess);
				sessionId.current = sess.id;
				setTokenUsage(() => ({ input: 0, output: 0 }));
			}
			persistMessage(userMsg);

			const sess = sessionStore.current.get(sessionId.current);
			if (sess && sess.messages.length === 1) {
				sess.title = trimmed.length > 60 ? trimmed.slice(0, 57) + '...' : trimmed;
				sessionStore.current.save(sess);
			}

			const start = performance.now();
			let currentAssistantId: string | null = null;
			currentTurnStartRef.current = start;

			try {
				const agent = await getOrCreateAgent(
					selectedModel,
					provider,
					selectedAgent,
					customProviders,
					thinkingEffort,
				);

				let promptInput = trimmed;
				const prevAgent = lastAgentRef.current;
				if (prevAgent && prevAgent !== selectedAgent) {
					const def = AGENT_DEFINITIONS[selectedAgent];
					const prevDef = AGENT_DEFINITIONS[prevAgent];
					if (prevDef?.mode === 'primary' && def?.mode === 'primary') {
						if (prevAgent === 'plan' && selectedAgent !== 'plan') {
							promptInput = `<system-reminder>\nYou are now in ${selectedAgent} mode. The previous agent was in plan mode — a plan may have been created. Execute on it if one exists.\n</system-reminder>\n\n${trimmed}`;
						} else if (selectedAgent === 'plan') {
							promptInput = `<system-reminder>\nPlan mode active. You are in read-only analysis mode — do NOT make edits, do NOT run destructive commands. Use read, glob, grep, and web_fetch only. When done, call plan_exit so the user can switch to build mode.\n</system-reminder>\n\n${trimmed}`;
						} else {
							promptInput = `<system-reminder>\nYou are now in ${selectedAgent} mode (was ${prevAgent}). Your available tools and behavior have changed to match this mode.\n</system-reminder>\n\n${trimmed}`;
						}
					}
				}

				// Capture pre-edit file state before any tools run
				try {
					preEditSnapshotRef.current = await snapshotManager.current.track();
				} catch (err) {
					preEditSnapshotRef.current = undefined;
					console.error('Snapshot track failed:', err);
				}

				for await (const ev of agent.run(promptInput)) {
					if (ev.type === 'message_start' && ev.message.role === 'assistant') {
						const newId = genId();
						currentAssistantId = newId;
						currentTurnMsgIdRef.current = newId;
						streamingIdRef.current = newId;
						addMessage({
							id: newId,
							role: 'assistant',
							content: '',
							blocks: [],
							streaming: true,
							model: selectedModel,
							agent: selectedAgent,
						});
					}
					if (ev.type === 'message_update' && ev.message.role === 'assistant' && currentAssistantId) {
						const m = ev.message as AssistantMessage;
						const blocks = getMessageBlocks(m);
						const textContent = blocks
							.filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
							.map((b) => b.content)
							.join('\n');
						updateMessage(currentAssistantId, { content: textContent, blocks });
						if (ev.assistantMessageEvent.type === 'toolcall_end') {
							const tc = (ev.assistantMessageEvent as any).toolCall as {
								id: string;
								name: string;
								arguments: Record<string, unknown>;
							};
							if (tc && !shownToolCalls.current.has(tc.id)) {
								shownToolCalls.current.add(tc.id);
								toolArgsMap.current.set(tc.id, tc.arguments);
								const tuiId = genId();
								toolMsgMap.current.set(tc.id, tuiId);
								addMessage({
									id: tuiId,
									role: 'tool',
									content: '',
									meta: `${tc.name}(${JSON.stringify(tc.arguments || {})})`,
									agent: selectedAgent,
								});
							}
						}
					}
					if (ev.type === 'message_end' && ev.message.role === 'assistant' && currentAssistantId) {
						const m = ev.message as AssistantMessage;
						const blocks = getMessageBlocks(m);
						const textContent = blocks
							.filter((b): b is ContentBlock & { type: 'text' } => b.type === 'text')
							.map((b) => b.content)
							.join('\n');
						const duration = performance.now() - (currentTurnStartRef.current ?? start);
						updateMessage(currentAssistantId, {
							content: textContent,
							blocks,
							streaming: false,
							turnTokens: { input: m.usage.input, output: m.usage.output },
							turnDurationMs: Math.round(duration),
						});

						// Compute patch: which files changed during this turn
						let patch: Patch | undefined;
						if (preEditSnapshotRef.current) {
							try {
								const patchResult = await snapshotManager.current.patch(preEditSnapshotRef.current);
								if (patchResult.files.length > 0) {
									patch = { hash: preEditSnapshotRef.current, files: patchResult.files };
								}
							} catch (err) {
								console.error('Snapshot patch failed:', err);
							}
						}

						persistMessage({
							...m,
							metadata: {
								...m.metadata,
								turnDurationMs: Math.round(duration),
								turnTokens: { input: m.usage.input, output: m.usage.output },
								patch,
							},
						});
						preEditSnapshotRef.current = undefined;
						const e = performance.now() - start;
						setElapsedMs(e);
						const ot = m.usage.output;
						if (ot > 0 && e > 0) setTokPerSec(ot / (e / 1000));
						setTokenUsage((p) => ({ input: m.usage.input, output: p.output + ot }));
						currentAssistantId = null;
						streamingIdRef.current = null;
					}
					if (ev.type === 'tool_execution_start') {
						if (!shownToolCalls.current.has(ev.toolCallId)) {
							shownToolCalls.current.add(ev.toolCallId);
							toolArgsMap.current.set(ev.toolCallId, ev.args);
							const tuiId = genId();
							toolMsgMap.current.set(ev.toolCallId, tuiId);
							addMessage({
								id: tuiId,
								role: 'tool',
								content: '',
								meta: `${ev.toolName}(${JSON.stringify(ev.args || {})})`,
								agent: selectedAgent,
							});
						}
					}
					if (ev.type === 'tool_execution_end') {
						const args = toolArgsMap.current.get(ev.toolCallId) || {};
						const resultDetails = (ev.result?.details as Record<string, unknown> | undefined) ?? {};
						const toolMsg: Message = {
							role: 'toolResult',
							toolCallId: ev.toolCallId,
							toolName: ev.toolName,
							content: ev.result?.content || [],
							details: { args, ...resultDetails },
							isError: ev.isError || false,
							timestamp: Date.now(),
						};
						persistMessage(toolMsg);
						const tuiId = toolMsgMap.current.get(ev.toolCallId);
						if (tuiId) {
							const toolOutput = ev.result?.content?.[0]?.text || '';
							const exitCode = typeof resultDetails.exitCode === 'number' ? resultDetails.exitCode : undefined;
							updateMessage(tuiId, { content: toolOutput, exitCode });
						}
					}
					if (ev.type === 'agent_end') {
						setStatus('Ready');
						if (currentTurnMsgIdRef.current) {
							updateMessage(currentTurnMsgIdRef.current, { turnStatus: 'completed' });
						}
						updateLastAssistantMeta({ turnStatus: 'completed' });
					}
				}
			} catch (err) {
				const errId = currentAssistantId || genId();
				updateMessage(errId, {
					content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					streaming: false,
					role: 'error',
				});
				if (currentTurnMsgIdRef.current) {
					updateMessage(currentTurnMsgIdRef.current, { turnStatus: 'error', streaming: false });
				}
				updateLastAssistantMeta({ turnStatus: 'error' });
				setStatus('Error');
			} finally {
				preEditSnapshotRef.current = undefined;
				setIsLoading(false);
				setSubmitKey((k) => k + 1);
				setInterruptKey(0);
				isStreamingRef.current = false;
				streamingIdRef.current = null;
				currentTurnStartRef.current = null;
				currentTurnMsgIdRef.current = null;

				const queued = queuedMessageRef.current;
				if (queued) {
					queuedMessageRef.current = null;
					await handleSubmit(queued);
				}
			}
		},
		[
			selectedModel,
			provider,
			selectedAgent,
			customProviders,
			thinkingEffort,
			cmdItems,
			slashNames,
			getOrCreateAgent,
			revertPoint,
			addMessage,
			updateMessage,
			sessionStore,
			sessionId,
			agentRef,
			loadedSessionMessages,
			snapshotManager,
			lastAgentRef,
			isStreamingRef,
			currentTurnStartRef,
			currentTurnMsgIdRef,
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
			securityRef,
		],
	);

	return {
		shownToolCalls,
		toolMsgMap,
		toolArgsMap,
		streamingIdRef,
		queuedMessageRef,
		handleSubmit,
		persistMessage,
		updateLastAssistantMeta,
	};
}
