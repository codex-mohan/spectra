import { z } from 'zod';
import type { Message } from '@mohanscodex/spectra-ai';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { getAgentDefinition, getSubagents, filterToolsByAgent } from '../agents/index.js';
import type { AgentDefinition } from '../agents/types.js';
import type { AgentRegistryConfig } from '../agents/registry.js';
import type { SecurityManager } from '../security/index.js';
import type { SessionStore } from '../services/session-store.js';
import { jobRegistry, type JobRecord } from '../services/job-registry.js';
import { registerJobHandle, unregisterJobHandle, getActiveAgent, setActiveAgent, clearActiveAgent } from '../services/job-control.js';
import { loadContext, buildContextMessages, type ContextComposeOptions } from '../services/context.js';
import { loadConfig, type ProjectReferenceConfig } from '../services/config.js';
import { runSubagent, type SubagentConfig } from '@mohanscodex/spectra-agent';

const DEFAULT_REPORTING = `Return a concise final report with: outcome, important details, work completed, checks performed or intentionally skipped, and blockers. Only mention files, code changes, or tests when they are relevant to the assignment.`;

interface StructuredTask {
	id?: string;
	name?: string;
	role?: string;
	description?: string;
	agent?: string;
	assignment: string;
	reporting?: string;
}

interface TaskArgs {
	context?: string;
	tasks?: StructuredTask[];
	agent?: string;
	subagent_type?: string;
	prompt?: string;
	description?: string;
	reporting?: string;
	background?: boolean;
	task_id?: string;
}

const structuredTaskSchema = z.object({
	id: z.string().optional().describe('Stable task id'),
	name: z.string().optional().describe('Stable job id suffix'),
	role: z.string().optional().describe('Specialist role for this item'),
	description: z.string().optional().describe('Short UI label'),
	agent: z.string().optional().describe('Subagent type for this item'),
	assignment: z.string().describe('Concrete assignment'),
	reporting: z.string().optional().describe('Reporting instructions'),
});

export interface NormalizedTask {
	id: string;
	role?: string;
	description: string;
	assignment: string;
	reporting?: string;
	agent?: string;
}

export interface NormalizedTaskRequest {
	agent: string;
	description: string;
	context?: string;
	tasks: NormalizedTask[];
	reporting?: string;
	background?: boolean;
	taskId?: string;
}

export function normalizeTaskArgs(args: TaskArgs): NormalizedTaskRequest {
	const agent = args.agent || args.subagent_type;
	if (!agent) throw new Error('Missing required parameter: agent');
	const tasks: NormalizedTask[] = args.tasks?.length
		? args.tasks.map((task, index) => ({
			id: task.id || task.name || `Task${index + 1}`,
			role: task.role,
			description: task.description || task.name || `Task ${index + 1}`,
			assignment: task.assignment,
			reporting: task.reporting,
			agent: task.agent,
		}))
		: [{
			id: 'Task1',
			description: args.description || 'Task',
			assignment: args.prompt || '',
			agent,
		}];
	if (tasks.some((task) => task.assignment.trim().length === 0)) throw new Error('Each task requires a non-empty assignment');
	return {
		agent,
		description: args.description || (tasks.length === 1 ? tasks[0].description : `${tasks.length} tasks`),
		context: args.context,
		tasks,
		reporting: args.reporting,
		background: args.background,
		taskId: args.task_id,
	};
}

export function buildTaskPrompt(task: StructuredTask | NormalizedTask, context: string | undefined, reporting: string | undefined, agentReporting: string | undefined): string {
	const sections: string[] = [];
	if (task.role) sections.push(`# Role\n${task.role}`);
	if (context?.trim()) sections.push(`# Context\n${context.trim()}`);
	sections.push(`# Assignment\n${task.assignment.trim()}`);
	sections.push(`# Reporting\n${(task.reporting || reporting || agentReporting || DEFAULT_REPORTING).trim()}`);
	return sections.join('\n\n');
}

export function buildSubagentSystemPrompt(cwd?: string, options: Omit<ContextComposeOptions, 'cwd'> = {}): string {
	return loadContext(cwd, options).systemPrompt;
}

function createSubagentConfig(
	config: AgentRegistryConfig,
	def: AgentDefinition,
	tools: NonNullable<SubagentConfig['tools']>,
	context: { cwd: string; sessionStartedAt?: Date; references?: readonly ProjectReferenceConfig[]; sessionId?: string },
	signal?: AbortSignal,
	extra: Partial<SubagentConfig> = {},
): SubagentConfig {
	return {
		model: config.model,
		systemPrompt: buildSubagentSystemPrompt(context.cwd, {
			model: config.model.id,
			provider: config.model.provider,
			sessionStartedAt: context.sessionStartedAt,
			references: context.references,
		}),
		tools,
		contextMessages: buildContextMessages(def.prompt),
		...(def.maxTurns ? { maxTurns: def.maxTurns } : {}),
		...(signal ? { signal } : {}),
		...(context.sessionId ? { sessionId: context.sessionId } : {}),
		getApiKey: config.getApiKey,
		...extra,
	};
}

function hasCommittedOutput(messages: Message[]): boolean {
	return messages.some((message) => message.role === 'assistant' && (
		message.content.some((part) => part.type === 'text' && part.text.trim().length > 0)
		|| message.content.some((part) => part.type === 'toolCall')
	));
}

function isRetryable(error: string | undefined): boolean {
	if (!error) return false;
	return /timeout|timed out|429|500|502|503|504|socket|network|fetch failed|ECONN|ETIMEDOUT|overloaded/i.test(error);
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await run(items[index], index);
		}
	});
	await Promise.all(workers);
	return results;
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
		description: `Launch one or more subagents. Each tasks[] item runs as an independent job with its own id, session, and result.
Set background=true to return immediately with job ids; use the job tool to inspect, wait, steer, pause, resume, restart, or cancel.`,
		displayName: (args: TaskArgs) => args.tasks?.length ? `${args.tasks.length} tasks` : (args.description || 'task'),
		parameters: z.object({
			context: z.string().optional().describe('Shared background for every task'),
			tasks: z.array(structuredTaskSchema).optional().describe('One independent subagent per item'),
			agent: z.string().optional().describe('Default subagent type'),
			subagent_type: z.string().optional().describe('Legacy alias for agent'),
			prompt: z.string().optional().describe('Single task assignment'),
			description: z.string().optional().describe('Short label for a single task'),
			reporting: z.string().optional().describe('Reporting instructions'),
			background: z.boolean().optional().describe('Run in the background'),
			task_id: z.string().optional().describe('Resume an existing task job'),
		}),
		execute: async (args: TaskArgs, ctx) => {
			const owner = ctx.sessionId ?? parentSessionId;
			if (!owner) {
				const candidate = args.agent || args.subagent_type || args.tasks?.[0]?.agent;
				if (candidate && !getAgentDefinition(candidate)) {
					return errorResult(`Unknown subagent "${candidate}". Available: ${getSubagents().join(', ')}`);
				}
				return errorResult('task requires a parent session');
			}

			if (args.task_id) {
				const existing = jobRegistry.get(args.task_id);
				if (!existing) return errorResult(`Unknown task_id: ${args.task_id}`);
				const handle = (await import('../services/job-control.js')).getJobHandle(args.task_id);
				if (!handle) return errorResult(`Task ${args.task_id} cannot resume (not live in this process).`);
				await handle.resume(args.prompt);
				return textResult(`Resumed ${args.task_id}.`, { childSessionId: args.task_id });
			}

			const items: StructuredTask[] = args.tasks?.length
				? args.tasks.map((item, index) => ({
					...item,
					description: item.description || item.name || `Task ${index + 1}`,
				}))
				: [{
					agent: args.agent || args.subagent_type,
					description: args.description || 'Task',
					assignment: args.prompt || '',
				}];

			if (items.some((item) => !item.assignment.trim())) return errorResult('Each task requires a non-empty assignment');
			const defaultAgent = args.agent || args.subagent_type;
			const names = new Set<string>();

			const prepared: Array<{ item: StructuredTask; agentName: string; def: AgentDefinition; childId?: string; jobId: string; prompt: string }> = [];
			for (const [index, item] of items.entries()) {
				const agentName = item.agent || defaultAgent;
				if (!agentName) return errorResult('task requires an agent for every item');
				if (names.has(agentName + (item.name ?? '')) && item.name) return errorResult(`Duplicate task name: ${item.name}`);
				if (item.name) names.add(agentName + item.name);
				const def = getAgentDefinition(agentName);
				if (!def) return errorResult(`Unknown subagent "${agentName}". Available: ${getSubagents().join(', ')}`);
				if (def.mode === 'primary') return errorResult(`"${agentName}" is a primary agent, not a subagent. Available: ${getSubagents().join(', ')}`);

				const description = item.description || item.name || `Task ${index + 1}`;
				const child = sessionStore?.createChild(owner, {
					title: `${agentName}: ${description}`.slice(0, 80),
					agent: agentName,
					model: config.model.id,
					provider: config.model.provider,
				});
				const jobId = child?.id ?? `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const prompt = buildTaskPrompt(item, args.context, args.reporting, def.reporting);
				jobRegistry.create({
					id: jobId,
					parentSessionId: owner,
					...(child ? { childSessionId: child.id } : {}),
					agent: agentName,
					description,
					prompt,
				});
				prepared.push({ item, agentName, def, childId: child?.id, jobId, prompt });
			}

			const session = sessionStore?.get(owner);
			const cwd = session?.directory || process.cwd();
			const loadedConfig = loadConfig(cwd);
			const references = loadedConfig.references;
			const concurrency = Math.min(16, Math.max(1, loadedConfig.tasks?.maxConcurrency ?? 4));
			const maxRuntimeMs = loadedConfig.tasks?.maxRuntimeMs;
			const controllers = new Map<string, AbortController>();

			const runAttempt = async (entry: typeof prepared[number], text: string, resumeMessages?: Message[]): Promise<void> => {
				const job = jobRegistry.get(entry.jobId);
				if (!job) return;
				const generation = jobRegistry.nextGeneration(entry.jobId);
				if (!jobRegistry.transition(entry.jobId, ['queued', 'paused', 'failed', 'completed'], 'running', { error: undefined })) return;

				const controller = new AbortController();
				controllers.set(entry.jobId, controller);
				const tools = filterToolsByAgent(
					(await import('./index.js')).createAllToolsWithSecurity(security, config, sessionStore, entry.childId ?? entry.jobId),
					entry.agentName,
				).filter((tool) => tool.name !== 'propose_skill');

				const deadline = maxRuntimeMs ? setTimeout(() => controller.abort(), maxRuntimeMs) : undefined;
				let attempt = 0;
				let result;
				for (;;) {
					attempt++;
					try {
						result = await runSubagent(
						createSubagentConfig(config, entry.def, tools, {
							cwd,
							sessionStartedAt: session?.created ? new Date(session.created) : undefined,
							references,
							sessionId: entry.childId,
						}, controller.signal, {
							...(resumeMessages && attempt === 1 ? { resumeMessages } : {}),
							onAgent: (agent) => setActiveAgent(entry.jobId, agent),
						}),
							text,
						);
					} catch (error) {
						clearTimeout(deadline);
						const message = error instanceof Error ? error.message : String(error);
						jobRegistry.fail(entry.jobId, generation, message);
						return;
					}
					if (entry.childId && sessionStore) {
						const startIndex = resumeMessages?.length ?? 0;
						for (const message of result.messages.slice(startIndex)) sessionStore.addMessage(entry.childId, message);
					}
					jobRegistry.update(entry.jobId, { retryAttempts: attempt - 1 });
					if (!result.error || result.text.trim() || attempt >= 2 || !isRetryable(result.error) || hasCommittedOutput(result.messages)) break;
					await new Promise<void>((resolve) => setTimeout(resolve, 500));
				}

				clearTimeout(deadline);
				clearActiveAgent(entry.jobId);
				controllers.delete(entry.jobId);
				const current = jobRegistry.get(entry.jobId);
				if (!current || current.state === 'cancelled') return;
				if (result.paused) {
					jobRegistry.transition(entry.jobId, ['running'], 'paused', { pauseRequested: false });
					return;
				}
				if (current.pauseRequested) {
					jobRegistry.pauseAtBoundary(entry.jobId, generation);
					return;
				}
				if (result.error && !result.text.trim()) jobRegistry.fail(entry.jobId, generation, result.error);
				else jobRegistry.complete(entry.jobId, generation, result.text || '(no output)');
			};

			for (const entry of prepared) {
				const job = jobRegistry.get(entry.jobId)!;
				const originalPrompt = entry.prompt;
				registerJobHandle(entry.jobId, {
					pause: () => {
						jobRegistry.pause(entry.jobId);
						getActiveAgent(entry.jobId)?.requestPause();
						return true;
					},
					cancel: () => {
						jobRegistry.cancel(entry.jobId);
						controllers.get(entry.jobId)?.abort();
						unregisterJobHandle(entry.jobId);
						return true;
					},
					send: (message: string) => {
						const active = getActiveAgent(entry.jobId);
						if (active) {
							active.steer(message);
							return true;
						}
						if (jobRegistry.get(entry.jobId)?.state === 'paused') {
							void runAttempt(entry, message, childMessages(entry));
							return true;
						}
						return false;
					},
					resume: async (instruction?: string) => {
						const current = jobRegistry.get(entry.jobId);
						if (current && current.state !== 'paused') return;
						await runAttempt(entry, instruction?.trim() || 'Continue from where you left off.', childMessages(entry));
					},
					restart: async (from) => {
						const messages = from === 'checkpoint' ? childMessages(entry) : undefined;
						if (from === 'start') clearChildMessages(entry);
						await runAttempt(entry, originalPrompt, messages);
					},
					currentActivity: () => (getActiveAgent(entry.jobId) ? 'running' : undefined),
				});
			}

			function childMessages(entry: typeof prepared[number]): Message[] {
				if (!entry.childId) return [];
				const child = sessionStore?.get(entry.childId);
				return (child?.messages ?? []) as Message[];
			}
			function clearChildMessages(entry: typeof prepared[number]): void {
				if (!entry.childId) return;
				const child = sessionStore?.get(entry.childId);
				if (!child) return;
				child.messages = [];
				sessionStore?.save(child);
			}

			if (args.background) {
				void mapLimit(prepared, concurrency, (entry) => runAttempt(entry, entry.prompt));
				return textResult(
					`Started ${prepared.length} background task(s):\n${prepared.map((entry) => `- ${entry.jobId} (${entry.agentName}) ${entry.item.description}`).join('\n')}\nUse the job tool to inspect or wait.`,
					{ jobs: prepared.map((entry) => entry.jobId) },
				);
			}

			await mapLimit(prepared, concurrency, (entry) => runAttempt(entry, entry.prompt));
			const results = prepared.map((entry) => jobRegistry.get(entry.jobId)).filter((job): job is JobRecord => Boolean(job));
			const failed = results.filter((job) => job.state === 'failed');
			const text = results.map((job) => `## ${job.description}\n${job.result ?? job.error ?? '(no output)'}`).join('\n\n');
			return failed.length > 0 && results.every((job) => job.state === 'failed')
				? errorResult(text)
				: textResult(text, { results: results.map((job) => ({ id: job.id, state: job.state, childSessionId: job.childSessionId })) });
		},
	};
}
