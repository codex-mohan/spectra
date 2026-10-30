import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { jobRegistry, type JobRecord } from '../services/job-registry.js';
import { getJobHandle } from '../services/job-control.js';
import type { SessionStore } from '../services/session-store.js';

function summarize(job: JobRecord): string {
	const elapsed = ((job.finishedAt ?? Date.now()) - job.queuedAt) / 1000;
	const status = job.state === 'failed' && job.error ? `failed: ${job.error}` : job.state;
	return `${job.id}  ${job.agent}  ${status}  ${elapsed.toFixed(1)}s  ${job.description}`;
}

export function createJobTool(sessionStore?: SessionStore, parentSessionId?: string): SpectraTool {
	return {
		name: 'job',
		capabilities: { reads: true, writes: false },
		description: `Manage background jobs owned by this session.
Ops: list, status, probe, transcript, wait, send, pause, resume, restart, cancel.
wait defaults to mode=all; timeout never cancels children.`,
		displayName: (args: { op: string }) => `job ${args.op}`,
		parameters: z.object({
			op: z.enum(['list', 'status', 'probe', 'transcript', 'wait', 'send', 'pause', 'resume', 'restart', 'cancel']),
			id: z.string().optional().describe('Job id'),
			ids: z.array(z.string()).optional().describe('Job ids for wait'),
			mode: z.enum(['first', 'all']).optional().describe('wait mode, default all'),
			timeoutMs: z.number().optional().describe('wait timeout, default 30000, max 300000'),
			message: z.string().optional().describe('Message for send/resume'),
			from: z.enum(['start', 'checkpoint']).optional().describe('restart source, default start'),
		}),
		execute: async (args, ctx) => {
			const owner = ctx.sessionId ?? parentSessionId ?? '';
			const owned = (): JobRecord[] => jobRegistry.forParent(owner).filter((job: JobRecord) => job.state !== 'cancelled' || args.op === 'list');

			switch (args.op) {
				case 'list': {
					const jobs = owned();
					return jobs.length === 0
						? textResult('No jobs for this session.')
						: textResult(jobs.map(summarize).join('\n'), { jobs });
				}
				case 'status':
				case 'probe': {
					if (!args.id) return errorResult('status/probe requires id');
					const job = jobRegistry.get(args.id);
					if (!job) return errorResult(`Job not found: ${args.id}`);
					const handle = getJobHandle(args.id);
					const activity = handle?.currentActivity();
					const lines = [
						summarize(job),
						`state: ${job.state}`,
						`generation: ${job.generation}`,
						`retries: ${job.retryAttempts}`,
						activity ? `activity: ${activity}` : '',
						job.result ? `result:\n${job.result.slice(0, 4000)}` : '',
						job.error ? `error: ${job.error}` : '',
					].filter(Boolean);
					return textResult(lines.join('\n'), { job });
				}
				case 'transcript': {
					if (!args.id) return errorResult('transcript requires id');
					const job = jobRegistry.get(args.id);
					if (!job || !sessionStore) return errorResult(`Transcript unavailable for ${args.id}`);
					const child = sessionStore.get(job.childSessionId ?? job.id);
					if (!child) return textResult('No persisted transcript.');
					const messages = child.messages.slice(-40).map((message) => {
						const content = Array.isArray(message.content)
							? message.content.map((part) => (part.type === 'text' ? part.text : `[${part.type}]`)).join(' ')
							: String(message.content);
						return `${message.role}: ${content.slice(0, 4000)}`;
					});
					return textResult(messages.join('\n\n'), { count: messages.length });
				}
				case 'wait': {
					const ids: string[] = args.ids?.length ? args.ids : owned().filter((job: JobRecord) => job.settledAt === undefined).map((job: JobRecord) => job.id);
					if (ids.length === 0) return textResult('Nothing to wait for.');
					const mode = args.mode ?? 'all';
					const timeoutMs = Math.min(300_000, Math.max(1_000, args.timeoutMs ?? 30_000));
					const deadline = Date.now() + timeoutMs;
					for (;;) {
						const jobs = ids.map((id: string) => jobRegistry.get(id)).filter((job): job is JobRecord => Boolean(job));
						const settled = jobs.filter((job: JobRecord) => job.settledAt !== undefined);
						const done = mode === 'all' ? settled.length === jobs.length : settled.length > 0;
						if (done || Date.now() >= deadline) {
							jobRegistry.consume(settled.map((job: JobRecord) => job.id));
							return textResult(
								settled.length === 0
									? `No jobs settled within ${timeoutMs}ms.`
									: settled.map(summarize).join('\n'),
								{ jobs: settled, timedOut: !done },
							);
						}
						await new Promise<void>((resolve) => setTimeout(resolve, 100));
					}
				}
				case 'send': {
					if (!args.id || !args.message) return errorResult('send requires id and message');
					const handle = getJobHandle(args.id);
					if (!handle) return errorResult(`Job ${args.id} cannot receive messages (not live in this process).`);
					return handle.send(args.message)
						? textResult(`Sent to ${args.id}.`)
						: errorResult(`Job ${args.id} is not accepting messages.`);
				}
				case 'pause': {
					if (!args.id) return errorResult('pause requires id');
					const handle = getJobHandle(args.id);
					if (!handle) {
						const paused = jobRegistry.pause(args.id);
						return paused ? textResult(`Paused ${args.id}.`) : errorResult(`Cannot pause ${args.id}.`);
					}
					return handle.pause() ? textResult(`Pausing ${args.id} at the next boundary.`) : errorResult(`Cannot pause ${args.id}.`);
				}
				case 'resume': {
					if (!args.id) return errorResult('resume requires id');
					const handle = getJobHandle(args.id);
					if (!handle) return errorResult(`Job ${args.id} cannot resume (not live in this process).`);
					await handle.resume(args.message);
					return textResult(`Resumed ${args.id}.`);
				}
				case 'restart': {
					if (!args.id) return errorResult('restart requires id');
					const handle = getJobHandle(args.id);
					if (!handle) return errorResult(`Job ${args.id} cannot restart (not live in this process).`);
					await handle.restart(args.from ?? 'start');
					return textResult(`Restarted ${args.id} from ${args.from ?? 'start'}.`);
				}
				case 'cancel': {
					if (!args.id) return errorResult('cancel requires id');
					const handle = getJobHandle(args.id);
					if (handle) handle.cancel();
					const cancelled = jobRegistry.cancel(args.id);
					return cancelled ? textResult(`Cancelled ${args.id}.`) : errorResult(`Cannot cancel ${args.id}.`);
				}
				default:
					return errorResult(`Unknown job op: ${args.op}`);
			}
		},
	};
}

export function createIrcTool(parentSessionId?: string): SpectraTool {
	return {
		name: 'irc',
		capabilities: { reads: true, writes: false },
		description: 'List peer subagents and send them a mid-run message. Running children receive it at the next step boundary; paused children resume with it.',
		parameters: z.object({
			op: z.enum(['list', 'send']),
			id: z.string().optional(),
			message: z.string().optional(),
		}),
		execute: async (args, ctx) => {
			const owner = ctx.sessionId ?? parentSessionId ?? '';
			if (args.op === 'list') {
				const jobs = jobRegistry.forParent(owner).filter((job: JobRecord) => job.state === 'running' || job.state === 'paused');
				return textResult(jobs.length === 0 ? 'No peers.' : jobs.map(summarize).join('\n'));
			}
			if (!args.id || !args.message) return errorResult('send requires id and message');
			const handle = getJobHandle(args.id);
			if (!handle) return errorResult(`Peer ${args.id} is not live.`);
			return handle.send(args.message) ? textResult(`Sent to ${args.id}.`) : errorResult(`Peer ${args.id} is not accepting messages.`);
		},
	};
}
