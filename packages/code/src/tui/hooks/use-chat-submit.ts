import { useRef, useCallback } from 'react';
import type { ChatMessage, ContentBlock } from '../types.js';
import type { Message, AssistantMessage, FileContent, TextContent } from '@mohanscodex/spectra-ai';
import type { PromptSubmitPayload } from '../prompt-bar.js';
import { calculateCost } from '@mohanscodex/spectra-ai';
import type { SessionStore } from '../../services/session-store.js';
import type { SessionManager } from '../../services/session-manager.js';
import type { SnapshotManager } from '../../services/snapshot-manager.js';
import type { Patch } from '../types.js';
import type { PromptHistoryService } from '../../services/prompt-history.js';
import { genId, getMessageBlocks } from '../utils.js';
import { AGENT_DEFINITIONS } from '../../agents/index.js';
import { parseSlashCommand } from '../slash-commands.js';
import { showToast } from '../components/toast.js';
import type { CmdItem } from '../components/command-palette.js';
import { setTerminalTitle, formatSessionTitle } from '../utils/terminal-title.js';
import type { useSessionState } from './use-session-state.js';

type SessionState = ReturnType<typeof useSessionState>;

interface UseChatSubmitDeps {
	sessionStore: React.MutableRefObject<SessionStore>;
	sessionManager: React.MutableRefObject<SessionManager>;
	sessionState: SessionState;
	switchSession: (id: string | null) => void;
	sessionId: React.MutableRefObject<string | null>;
	securityRef: React.MutableRefObject<any>;
	snapshotManager: React.MutableRefObject<SnapshotManager>;
	lastAgentRef: React.MutableRefObject<string | null>;
	isStreamingRef: React.MutableRefObject<boolean>;
	currentTurnStartRef: React.MutableRefObject<number | null>;
	currentTurnMsgIdRef: React.MutableRefObject<string | null>;
	revertPoint: string | null;
	getOrCreateAgent: (
		sessionId: string,
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
	setMessages: (fn: (prev: ChatMessage[]) => ChatMessage[]) => void;
	setIsLoading: (v: boolean) => void;
	setStatus: (s: string) => void;
	setRoute: (r: 'home' | 'chat') => void;
	setElapsedMs: (v: number | null) => void;
	setTokPerSec: (v: number | null) => void;
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
		sessionManager,
		sessionState,
		switchSession,
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
	} = deps;

	const shownToolCalls = useRef(new Set<string>());
	const toolMsgMap = useRef(new Map<string, string>());
	const toolArgsMap = useRef(new Map<string, unknown>());
	const streamingIdRef = useRef<string | null>(null);
	const streamingSessionsRef = useRef(new Set<string>());
	const queuedMessageRef = useRef<PromptSubmitPayload | null>(null);
	const preEditSnapshotRef = useRef<string | undefined>(undefined);
	const titleGeneratedRef = useRef(false);
	const firstUserMessageRef = useRef<string | null>(null);

	function persistMessage(targetSessionId: string, sdkMsg: Message) {
		if (!targetSessionId) return;
		sessionStore.current.addMessage(targetSessionId, sdkMsg);
	}

	function updateLastAssistantMeta(targetSessionId: string, meta: Record<string, unknown>) {
		if (!targetSessionId) return;
		const sess = sessionStore.current.get(targetSessionId);
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

	async function fireTitleAgent(userText: string, assistantText: string) {
		if (titleGeneratedRef.current) return;
		titleGeneratedRef.current = true;

		try {
			const { stream } = await import('@mohanscodex/spectra-ai');
			const titleDef = AGENT_DEFINITIONS['title'];
			let modelId = titleDef?.model?.id ?? deps.selectedModel;
			let prov = titleDef?.model?.provider ?? deps.provider;
			if (!modelId || !prov) return;

			const { getAuthKey } = await import('../utils/model-config.js');
			let apiKey = getAuthKey(prov);

			if (!apiKey && titleDef?.model?.provider) {
				modelId = deps.selectedModel!;
				prov = deps.provider!;
				apiKey = getAuthKey(prov);
			}
			if (!apiKey) return;

			const prompt = `Generate a concise session title (3-6 words) for this conversation.

User: ${userText.slice(0, 500)}
Assistant: ${assistantText.slice(0, 500)}

Rules:
- 3-6 words maximum
- Summarize the topic or task
- No quotes, no punctuation at the end
- Title case
- Be specific, not generic

Return ONLY the title text, nothing else.`;

			let title = '';
			const modelObj = { id: modelId, name: modelId, provider: prov, api: prov };
			const ctx = { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] };
			const events = stream(modelObj as any, ctx, { apiKey });

			for await (const event of events) {
				if (event.type === 'text_delta' && event.delta) {
					title += event.delta;
				}
			}

			title = title.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').split('\n')[0].trim();
			if (title.length > 50) title = title.slice(0, 50).trim();
			if (title.length === 0) return;

			if (!sessionId.current) return;
			const sess = sessionStore.current.get(sessionId.current);
			if (!sess) return;
			sess.title = title;
			sessionStore.current.save(sess);

			setTerminalTitle(formatSessionTitle(title));
		} catch {
			// Title generation failed silently
		}
	}
	const handleSubmit = useCallback(
		async (payload: PromptSubmitPayload) => {
			const { text: trimmed, attachments } = payload;
			if (!trimmed && attachments.length === 0) return;

			// Only block if THIS session is streaming
			const currentSessionId = sessionId.current || '';
			if (streamingSessionsRef.current.has(currentSessionId)) {
				queuedMessageRef.current = { text: trimmed, attachments };
				return;
			}

			// Slash commands only work when there are no attachments
			if (attachments.length === 0) {
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
			if (trimmed) promptHistoryService.current.append(trimmed);

			// Create session FIRST so switchSession sets activeIdRef before any messages
			if (!sessionId.current) {
				const sess = sessionStore.current.create({
					agent: selectedAgent,
					model: selectedModel,
					provider,
					thinkingEffort: thinkingEffort || undefined,
				});
				sess.title = `Session ${new Date().toISOString()}`;
				sessionStore.current.save(sess);
				sessionId.current = sess.id;
				switchSession(sess.id);
				sessionManager.current.createSession(sess.id);
				sessionManager.current.setActiveSession(sess.id);
				sessionState.setTokenUsageIn(sess.id, () => ({ input: 0, output: 0 }));
				sessionState.set(sess.id, { costSoFar: 0 });
			}

			// Capture the session ID for this run — all events target THIS session
			const runSessionId = sessionId.current!;

			// Build message content: text + file attachments
			const userContent: Message['content'] = attachments.length > 0
				? [
					...(trimmed ? [{ type: 'text' as const, text: trimmed } satisfies TextContent] : []),
					...attachments.map((att): FileContent => ({
						type: 'file' as const,
						mime: att.mime,
						filename: att.filename,
						url: att.url,
						source: att.source,
						metadata: att.metadata,
					})),
				]
				: trimmed;

			const uid = genId();
			const userMsg: Message = { role: 'user', content: userContent, timestamp: Date.now() };
			const displayContent = trimmed || (attachments.length > 0 ? `[${attachments.length} file${attachments.length > 1 ? 's' : ''}]` : '');
			sessionState.addMessageTo(runSessionId, { id: uid, role: 'user', content: displayContent, attachments, model: selectedModel });
			sessionState.setLoadingIn(runSessionId, true);
			sessionState.setStatusIn(runSessionId, 'Streaming...');
			setRoute('chat');
			streamingSessionsRef.current.add(runSessionId);
			isStreamingRef.current = true;
			streamingIdRef.current = 'pending';

			persistMessage(runSessionId, userMsg);

			const sess = sessionStore.current.get(runSessionId);
			if (sess && sess.messages.length === 1) {
				const titleText = displayContent.length > 60 ? displayContent.slice(0, 57) + '...' : displayContent;
				sess.title = titleText;
				sessionStore.current.save(sess);
				firstUserMessageRef.current = displayContent;
			}

			const start = performance.now();
			let currentAssistantId: string | null = null;
			currentTurnStartRef.current = start;

			try {
				const agent = await getOrCreateAgent(
					runSessionId,
					selectedModel,
					provider,
					selectedAgent,
					customProviders,
					thinkingEffort,
				);

				let promptInputText = trimmed;
				const prevAgent = lastAgentRef.current;
				if (prevAgent && prevAgent !== selectedAgent) {
					const def = AGENT_DEFINITIONS[selectedAgent];
					const prevDef = AGENT_DEFINITIONS[prevAgent];
					if (prevDef?.mode === 'primary' && def?.mode === 'primary') {
						if (prevAgent === 'plan' && selectedAgent !== 'plan') {
							promptInputText = `<system-reminder>\nYou are now in ${selectedAgent} mode. The previous agent was in plan mode — a plan may have been created. Execute on it if one exists.\n</system-reminder>\n\n${trimmed}`;
						} else if (selectedAgent === 'plan') {
							promptInputText = `<system-reminder>\nPlan mode active. You are in read-only analysis mode — do NOT make edits, do NOT run destructive commands. Use read, glob, grep, and web_fetch only. When done, call plan_exit so the user can switch to build mode.\n</system-reminder>\n\n${trimmed}`;
						} else {
							promptInputText = `<system-reminder>\nYou are now in ${selectedAgent} mode (was ${prevAgent}). Your available tools and behavior have changed to match this mode.\n</system-reminder>\n\n${trimmed}`;
						}
					}
				}

				try {
					preEditSnapshotRef.current = await snapshotManager.current.track();
				} catch (err) {
					preEditSnapshotRef.current = undefined;
					console.error('Snapshot track failed:', err);
				}

				for await (const ev of agent.run(attachments.length > 0 ? { ...userMsg, content: userContent } : promptInputText)) {
					if (ev.type === 'message_start' && ev.message.role === 'assistant') {
						const newId = genId();
						currentAssistantId = newId;
						currentTurnMsgIdRef.current = newId;
						streamingIdRef.current = newId;
						sessionState.addMessageTo(runSessionId, {
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
						sessionState.updateMessageIn(runSessionId, currentAssistantId, { content: textContent, blocks });
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
								sessionState.addMessageTo(runSessionId, {
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
						sessionState.updateMessageIn(runSessionId, currentAssistantId, {
							content: textContent,
							blocks,
							streaming: false,
							turnTokens: { input: m.usage.input, output: m.usage.output },
							turnDurationMs: Math.round(duration),
						});

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

					persistMessage(runSessionId, {
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
						sessionState.setElapsedMsIn(runSessionId, e);
						const ot = m.usage.output;
						if (ot > 0 && e > 0) sessionState.setTokPerSecIn(runSessionId, ot / (e / 1000));
						sessionState.setTokenUsageIn(runSessionId, (p) => ({ input: Math.max(p.input, m.usage.input), output: p.output + ot }));
						const turnCost = calculateCost(selectedModel, { input: m.usage.input, output: m.usage.output });
						if (turnCost.total > 0) sessionState.addCostIn(runSessionId, turnCost.total);
						currentAssistantId = null;
						streamingIdRef.current = null;

						if (firstUserMessageRef.current) {
							const userText = firstUserMessageRef.current;
							firstUserMessageRef.current = null;
							const assistantText = typeof m.content === 'string' ? m.content : '';
							fireTitleAgent(userText, assistantText).catch(() => {});
						}

						if (runSessionId) {
							const sid = runSessionId;
							(async () => {
								try {
									const { generateSkillContent, isSessionEligibleForSynthesis, loadAllEvolvingSkills, saveEvolvingSkill, findSimilarSkill, evolveSkill } = await import('@mohanscodex/spectra-agent');
									const { loadConfig } = await import('../../services/config.js');
									const cfg = loadConfig();

									if (cfg.skills?.autoSynthesize === false) return;

									const sess = sessionStore.current.get(sid);
									if (!sess) return;

									const toolCalls: { name: string; args: unknown; success: boolean }[] = [];
									for (const msg of sess.messages) {
										if (msg.role === 'assistant') {
											const content = Array.isArray(msg.content) ? msg.content : [];
											for (const block of content) {
												if (block.type === 'toolCall') {
													const tc = block as { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> };
													const resultMsg = sess.messages.find(
														(r) => r.role === 'toolResult' && (r as any).toolCallId === tc.id,
													);
													toolCalls.push({
														name: tc.name,
														args: tc.arguments,
														success: !resultMsg || !(resultMsg as any).isError,
													});
												}
											}
										}
									}

									const trace = {
										messages: sess.messages,
										toolCalls,
										duration: e,
									};

									if (!isSessionEligibleForSynthesis(trace)) return;

									const generated = generateSkillContent(trace);
									if (!generated) return;

									const { id, name, description, whenToUse, content } = generated;

									if (cfg.skills?.confirmBeforeSave !== false) {
										const { enqueuePendingSkill } = await import('../../services/pending-skills.js');
										enqueuePendingSkill({ id, name, description, whenToUse, content, createdAt: new Date().toISOString() });
										showToast(`Learned new skill: ${name}. Use /skills to save.`, 'info');
										return;
									}

									const existing = await loadAllEvolvingSkills();
									const { saveEvolvingSkill: save, findSimilarSkill: findSimilar, evolveSkill: evolve } = await import('@mohanscodex/spectra-agent');
									const similar = await findSimilar(name, description, whenToUse, existing);
									if (similar) {
										await evolve(similar.name, { description, whenToUse }, content);
										showToast(`Evolved skill: ${similar.name}`, 'success');
									} else {
										const meta = { id, name, description, whenToUse, tags: [] as string[], useCount: 0, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), origin: 'learned' as const };
										await save(meta, content);
										showToast(`Saved skill: ${name}`, 'success');
									}
								} catch {
									// Synthesis failed silently
								}
							})();
						}
					}
					if (ev.type === 'tool_execution_start') {
						if (!shownToolCalls.current.has(ev.toolCallId)) {
							shownToolCalls.current.add(ev.toolCallId);
							toolArgsMap.current.set(ev.toolCallId, ev.args);
							if (ev.toolName === 'task') {
								const taskArgs = (ev.args ?? {}) as Record<string, unknown>;
								const subagent = String(taskArgs.subagent_type || 'subagent');
								const description = taskArgs.description ? `: ${String(taskArgs.description)}` : '';
								sessionState.setStatusIn(runSessionId, `Subagent @${subagent} running${description}`.slice(0, 120));
							}
							const tuiId = genId();
							toolMsgMap.current.set(ev.toolCallId, tuiId);
							sessionState.addMessageTo(runSessionId, {
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
						const toolOutput = ev.result?.content?.[0]?.text || '';
						if (ev.isError) {
							const firstLine =
								toolOutput.split('\n').find((line: string) => line.trim().length > 0)?.trim() || 'Unknown error';
							if (ev.toolName === 'task') {
								const taskArgs = args as Record<string, unknown>;
								const subagent = String(taskArgs.subagent_type || 'subagent');
								sessionState.setStatusIn(runSessionId, `Subagent @${subagent} failed: ${firstLine}`.slice(0, 160));
							} else {
								sessionState.setStatusIn(runSessionId, `${ev.toolName} failed: ${firstLine}`.slice(0, 160));
							}
						} else if (ev.toolName === 'task') {
							const taskArgs = args as Record<string, unknown>;
							const subagent = String(taskArgs.subagent_type || 'subagent');
							sessionState.setStatusIn(runSessionId, `Subagent @${subagent} completed`);
						}
						const toolMsg: Message = {
							role: 'toolResult',
							toolCallId: ev.toolCallId,
							toolName: ev.toolName,
							content: ev.result?.content || [],
							details: { args, ...resultDetails },
							isError: ev.isError || false,
							timestamp: Date.now(),
						};
						persistMessage(runSessionId, toolMsg);
const tuiId = toolMsgMap.current.get(ev.toolCallId);
				if (tuiId) {
						const exitCode = typeof resultDetails.exitCode === 'number' ? resultDetails.exitCode : undefined;
						const wallTimeMs = typeof resultDetails.wallTimeMs === 'number' ? resultDetails.wallTimeMs : undefined;
						const timeoutMs = typeof resultDetails.timeoutMs === 'number' ? resultDetails.timeoutMs : undefined;
						const childSessionId = typeof resultDetails.childSessionId === 'string' ? resultDetails.childSessionId : undefined;
						const isBackground = resultDetails.background === true ? true : undefined;
						sessionState.updateMessageIn(runSessionId, tuiId, {
							content: toolOutput,
							exitCode,
							toolError: ev.isError || undefined,
							wallTimeMs,
							timeoutMs,
							childSessionId,
							background: isBackground,
						});
					}
				}
					if (ev.type === 'agent_end') {
						sessionState.setStatusIn(runSessionId, 'Ready');
						if (currentTurnMsgIdRef.current) {
							sessionState.updateMessageIn(runSessionId, currentTurnMsgIdRef.current, { turnStatus: 'completed' });
						}
						updateLastAssistantMeta(runSessionId, { turnStatus: 'completed' });
					}
				}
			} catch (err) {
				const errId = currentAssistantId || genId();
				sessionState.updateMessageIn(runSessionId, errId, {
					content: `Error: ${err instanceof Error ? err.message : String(err)}`,
					streaming: false,
					role: 'error',
				});
				if (currentTurnMsgIdRef.current) {
					sessionState.updateMessageIn(runSessionId, currentTurnMsgIdRef.current, { turnStatus: 'error', streaming: false });
				}
				updateLastAssistantMeta(runSessionId, { turnStatus: 'error' });
				sessionState.setStatusIn(runSessionId, 'Error');
			} finally {
				preEditSnapshotRef.current = undefined;
				sessionState.setLoadingIn(runSessionId, false);
				setSubmitKey((k) => k + 1);
				setInterruptKey(0);
				streamingSessionsRef.current.delete(runSessionId);
				isStreamingRef.current = streamingSessionsRef.current.size > 0;
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
			sessionState,
			switchSession,
			sessionStore,
			sessionId,
			securityRef,
			snapshotManager,
			lastAgentRef,
			isStreamingRef,
			currentTurnStartRef,
			currentTurnMsgIdRef,
			setRoute,
			setSubmitKey,
			setInterruptKey,
			setRevertPoint,
			discardRevert,
			promptHistoryService,
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
