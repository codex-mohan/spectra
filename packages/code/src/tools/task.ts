import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { textResult, errorResult } from './utils.js';
import { AGENT_DEFINITIONS, SUBAGENTS, filterToolsByAgent } from '../agents/index.js';
import type { AgentRegistryConfig } from '../agents/registry.js';
import type { SecurityManager } from '../security/index.js';
import type { SessionStore } from '../services/session-store.js';
import { backgroundTasks } from '../services/background-tasks.js';
import { runSubagent } from '@mohanscodex/spectra-agent';
import { getSystemPrompt } from '../utils/platform.js';

function descriptionForTaskTool(): string {
	const subagentList = SUBAGENTS.map((name) => {
		const def = AGENT_DEFINITIONS[name];
		return `- **${name}**: ${def.description}`;
	}).join('\n');

	return `Launch a new agent to handle complex, multistep tasks autonomously.

When to use the Task tool:
${subagentList}

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. Each agent invocation starts with a fresh context
3. The agent's outputs should generally be trusted
4. Clearly tell the agent whether you expect it to write code or just to do research
5. Set background=true to run the agent in the background (returns immediately with a task_id)
6. Pass task_id to resume or extend a previous task (running tasks queue additional work)`;
}

export function createTaskTool(
	config: AgentRegistryConfig,
	security: SecurityManager,
	sessionStore?: SessionStore,
	parentSessionId?: string,
): SpectraTool {
	return {
		name: 'task',
		capabilities: { reads: false, writes: false },
		description: descriptionForTaskTool(),
		displayName: (args: { description: string }) =>
			`@${(args as any).subagent_type || 'subagent'} ${args.description || ''}`.slice(0, 60),
		parameters: z.object({
			description: z.string().describe('A short (3-5 words) description of the task'),
			prompt: z.string().describe('The task for the agent to perform'),
			subagent_type: z.string().describe('The type of specialized agent to use for this task'),
			background: z.boolean().optional().describe('Run in background (returns immediately with a task_id)'),
			task_id: z.string().optional().describe('Resume or extend a previous task by its id'),
		}),

		execute: async (args, ctx) => {
			const { description, prompt, subagent_type, background, task_id } = args as {
				description: string;
				prompt: string;
				subagent_type: string;
				background?: boolean;
				task_id?: string;
			};

			const def = AGENT_DEFINITIONS[subagent_type];
			if (!def) {
				const available = SUBAGENTS.join(', ');
				return errorResult(`Unknown subagent "${subagent_type}". Available: ${available}`);
			}
			if (def.mode !== 'subagent') {
				return errorResult(
					`"${subagent_type}" is a primary agent, not a subagent. Available subagents: ${SUBAGENTS.join(', ')}`,
				);
			}

			try {
				const { createAllToolsWithSecurity } = await import('./index.js');

				const buildSubTools = (parentId: string | undefined) => {
					const allTools = createAllToolsWithSecurity(security, config, sessionStore, parentId);
					return filterToolsByAgent(allTools, subagent_type);
				};

				// ─── Phase 4/5: task_id handling (extend / resume) ─────────────────
				if (task_id) {
					const existing = backgroundTasks.get(task_id);
					if (existing && existing.status === 'running') {
						// Phase 4: extend — queue new work for a running task
						if (backgroundTasks.extend(task_id, prompt)) {
							return textResult(
								`Extending task ${task_id} with new work. It will run after the current work completes.`,
							);
						}
					} else if (existing && (existing.status === 'completed' || existing.status === 'error')) {
						if (sessionStore && existing.parentSessionId) {
							const childData = sessionStore.get(task_id);
							if (childData) {
								backgroundTasks.start({
									id: task_id,
									parentSessionId: existing.parentSessionId,
									agentType: subagent_type,
									description,
									status: 'running',
									startedAt: Date.now(),
									background: false,
								});
								const tools = buildSubTools(task_id);
								const resumeResult = await runSubagent(
									{
										model: config.model,
										systemPrompt: [getSystemPrompt(), def.prompt].filter(Boolean).join('\n\n'),
										tools,
										...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
										signal: ctx.signal,
										getApiKey: config.getApiKey,
									} as any,
									prompt,
								);
								for (const m of resumeResult.messages) sessionStore.addMessage(task_id, m);
								backgroundTasks.complete(task_id, resumeResult.text || resumeResult.error || '', resumeResult.messages);
								const text = resumeResult.text || (resumeResult.error ? `Error: ${resumeResult.error}` : '');
								return {
									content: [{ type: 'text' as const, text: text || 'Subagent completed' }],
									details: { childSessionId: task_id, resumed: true, agentType: subagent_type },
								};
							}
						}
					}
				}

				const hasParent = !!(sessionStore && parentSessionId);

				// Helper to create + persist child session, returning its id (or undefined)
				const createChildSession = (): string | undefined => {
					if (!sessionStore || !parentSessionId) return undefined;
					const child = sessionStore.createChild(parentSessionId, {
						title: `${subagent_type}: ${description}`.slice(0, 80),
						agent: subagent_type,
						model: config.model.id,
						provider: config.model.provider,
					});
					return child.id;
				};

				// Helper that runs runSubagent and persists messages to the child session
				const runAndPersist = async (childId: string) => {
					const tools = buildSubTools(childId);
					const result = await runSubagent(
						{
							model: config.model,
							systemPrompt: [getSystemPrompt(), def.prompt].filter(Boolean).join('\n\n'),
							tools,
							...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
							signal: ctx.signal,
							getApiKey: config.getApiKey,
						} as any,
						prompt,
					);
					if (sessionStore) {
						for (const m of result.messages) sessionStore.addMessage(childId, m);
					}
					return result;
				};

				// ─── Phase 2: background mode ───────────────────────────────────
				if (background) {
					if (!hasParent) {
						return errorResult('Background tasks require a parent session (no sessionStore/parentSessionId available).');
					}
					const childId = createChildSession();
					if (!childId) return errorResult('Failed to create child session for background task.');

					backgroundTasks.start({
						id: childId,
						parentSessionId,
						agentType: subagent_type,
						description,
						status: 'running',
						startedAt: Date.now(),
						background: true,
					});

					// Spawn async — don't await. Drain any queued extensions after completion.
					(async () => {
						try {
							let result = await runAndPersist(childId);
							let resultText = result.text || result.error || '';
							const extensions = backgroundTasks.drainExtensions(childId);
							for (const extPrompt of extensions) {
								const extTools = buildSubTools(childId);
								const extResult = await runSubagent(
									{
										model: config.model,
										systemPrompt: [getSystemPrompt(), def.prompt].filter(Boolean).join('\n\n'),
										tools: extTools,
										...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
										getApiKey: config.getApiKey,
									} as any,
									extPrompt,
								);
								if (sessionStore) {
									for (const m of extResult.messages) sessionStore.addMessage(childId, m);
								}
								resultText = extResult.text || extResult.error || resultText;
								result = extResult;
							}
							backgroundTasks.complete(childId, resultText, result.messages);
						} catch (err) {
							backgroundTasks.error(childId, err instanceof Error ? err.message : String(err));
						}
					})().catch(() => {
						backgroundTasks.error(childId, 'Unhandled background task error');
					});

					return {
						content: [{ type: 'text' as const, text: `Background task started: ${description} (task_id: ${childId})` }],
						details: { childSessionId: childId, background: true, agentType: subagent_type },
					};
				}

				// ─── Phase 1/3: foreground (with optional promotion) ────────────
				const childId = createChildSession();

				if (!childId) {
					// No session available — run inline like the legacy path
					const tools = buildSubTools(undefined);
					const result = await runSubagent(
						{
							model: config.model,
							systemPrompt: [getSystemPrompt(), def.prompt].filter(Boolean).join('\n\n'),
							tools,
							...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
							signal: ctx.signal,
							getApiKey: config.getApiKey,
						} as any,
						prompt,
					);
					const resultText = (result.text || '').trim();
					return textResult(resultText || `Subagent @${subagent_type} completed with no text output.`);
				}

				const childPromise = runAndPersist(childId);

				// Promotion support: if registered in backgroundTasks, race against promotion signal
				backgroundTasks.start({
					id: childId,
					parentSessionId: parentSessionId!,
					agentType: subagent_type,
					description,
					status: 'running',
					startedAt: Date.now(),
					background: false,
				});

				let promotionPromise: Promise<'promoted'> | undefined;
				let pollInterval: ReturnType<typeof setInterval> | undefined;
				let cleanupPromotion: (() => void) | undefined;

				const checkPromotion = () =>
					new Promise<'promoted'>((resolve) => {
						pollInterval = setInterval(() => {
							if (backgroundTasks.isPromoted(childId)) {
								if (pollInterval) clearInterval(pollInterval);
								resolve('promoted');
							}
						}, 100);
					});

				promotionPromise = checkPromotion();
				cleanupPromotion = () => {
					if (pollInterval) clearInterval(pollInterval);
				};

				const raceOutcome = await Promise.race([
					childPromise.then(() => 'completed' as const),
					promotionPromise,
				]);
				cleanupPromotion();

				if (raceOutcome === 'promoted') {
					// Detach to background — let the promise continue, then complete the task registry
					childPromise
						.then((res) => {
							backgroundTasks.complete(childId, res.text || res.error || '', res.messages);
						})
						.catch((err) => {
							backgroundTasks.error(childId, err instanceof Error ? err.message : String(err));
						});
					return {
						content: [{ type: 'text' as const, text: `Moved foreground task to background: ${description} (task_id: ${childId})` }],
						details: { childSessionId: childId, background: true, promoted: true, agentType: subagent_type },
					};
				}

				// Foreground completed normally
				const result = await childPromise;
				const resultText = (result.text || '').trim();
				const errText = result.error;
				backgroundTasks.complete(childId, resultText || errText || '', result.messages);

				if (result.aborted && ctx.signal?.aborted) {
					return textResult(`Subagent @${subagent_type} was interrupted.`);
				}
				if (errText && !resultText) {
					return errorResult(`Subagent @${subagent_type} failed: ${errText}`);
				}
				return {
					content: [{ type: 'text' as const, text: resultText || `Subagent @${subagent_type} completed with no text output.` }],
					details: { childSessionId: childId, agentType: subagent_type },
				};
			} catch (err) {
				if (ctx.signal?.aborted) {
					return textResult(`Subagent @${subagent_type} was interrupted.`);
				}
				return errorResult(`Subagent @${subagent_type} failed: ${err instanceof Error ? err.message : String(err)}`);
			}
		},
	};
}