import { z } from 'zod';
import type { Message, ToolResultMessage } from '@mohanscodex/spectra-ai';
import type { SpectraTool } from './types.js';
import { errorResult } from './utils.js';
import type { SessionStore } from '../services/session-store.js';

export type TodoStatus = 'pending' | 'in_progress' | 'done' | 'dropped';
export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoTask {
	id: string;
	title: string;
	status: TodoStatus;
	priority?: TodoPriority;
}

export interface TodoPhase {
	id: string;
	title: string;
	tasks: TodoTask[];
}

export interface TodoState {
	phases: TodoPhase[];
}

export interface TodoDetails {
	action: string;
	todoState: TodoState;
	summary: string;
	error?: string;
}

const statusValues = ['pending', 'in_progress', 'done', 'dropped'] as const;
const priorityValues = ['high', 'medium', 'low'] as const;

const taskInput = z.object({
	id: z.string().optional().describe('Stable task ID. If omitted, Spectra generates a short ID.'),
	title: z.string().describe('Human-readable task title'),
	status: z.enum(statusValues).optional().describe('Task status'),
	priority: z.enum(priorityValues).optional().describe('Task priority'),
});

const phaseInput = z.object({
	id: z.string().optional().describe('Stable phase ID. If omitted, Spectra generates a short ID.'),
	title: z.string().describe('Human-readable phase title'),
	tasks: z.array(taskInput).optional().describe('Tasks in this phase'),
});

const todoParams = z.preprocess(
	normalizeTodoArgs,
	z.object({
		op: z.enum(['init', 'add_phase', 'add', 'start', 'done', 'drop', 'update', 'move', 'view', 'clear']).describe('Todo operation'),
		phases: z.array(phaseInput).optional().describe('Full phase tree for init'),
		phase: phaseInput.optional().describe('Phase payload for add_phase'),
		phaseId: z.string().optional().describe('Target phase ID'),
		task: taskInput.optional().describe('Task payload for add'),
		id: z.string().optional().describe('Task ID for start/done/drop/update/move'),
		title: z.string().optional().describe('New task title for update'),
		status: z.enum(statusValues).optional().describe('New task status for update'),
		priority: z.enum(priorityValues).optional().describe('New task priority for update'),
		afterId: z.string().optional().describe('Place moved task after this task ID'),
		beforeId: z.string().optional().describe('Place moved task before this task ID'),
		reason: z.string().optional().describe('Reason for dropping a task'),
	}),
);

type TodoArgs = z.infer<typeof todoParams>;

export function createTodoTool(sessionStore?: SessionStore, sessionId?: string): SpectraTool {
	let state = loadTodoState(sessionStore, sessionId);
	let nextPhase = nextNumberedId(state.phases.map((phase) => phase.id), 'p');
	let nextTask = nextNumberedId(state.phases.flatMap((phase) => phase.tasks.map((task) => task.id)), 't');

	const ensurePhase = (phaseId?: string): TodoPhase => {
		if (phaseId) {
			const existing = state.phases.find((phase) => phase.id === phaseId);
			if (existing) return existing;
		}
		if (state.phases.length === 0) {
			const phase = { id: `p${nextPhase++}`, title: 'Tasks', tasks: [] };
			state = { phases: [phase] };
			return phase;
		}
		return state.phases[state.phases.length - 1];
	};

	const findTask = (id: string): { phase: TodoPhase; task: TodoTask; index: number } | undefined => {
		for (const phase of state.phases) {
			const index = phase.tasks.findIndex((task) => task.id === id);
			if (index >= 0) return { phase, task: phase.tasks[index], index };
		}
		return undefined;
	};

	const complete = (action: string): { content: [{ type: 'text'; text: string }]; details: TodoDetails } => {
		const summary = summarize(state);
		return {
			content: [{ type: 'text', text: `${summary}\n\n${formatStateForModel(state)}` }],
			details: { action, todoState: cloneState(state), summary },
		};
	};

	return {
		name: 'todo',
		displayName: 'Todo',
		capabilities: { reads: false, writes: false },
		description: `Create and maintain a phased task list for the current coding session.

Use this for multi-step work. Preserve hierarchy by grouping tasks into phases. Mutate tasks by stable IDs, not titles. Keep exactly one task in_progress while actively working. Mark tasks done only after the work, including required verification, is complete.

Statuses: pending, in_progress, done, dropped.`,
		promptGuidelines: [
			'Use todo for tasks with 3+ meaningful steps, explicit multi-item requests, or work that needs progress tracking.',
			'Use init with phases to create a hierarchical plan. Use short stable IDs for later CRUD.',
			'Use start before beginning a task and done only after implementation plus required verification.',
			'Use update by ID to rename/rephase/reprioritize; never rely on exact title text as identity.',
		],
		parameters: todoParams,
		execute: async (args: TodoArgs) => {
			switch (args.op) {
				case 'init': {
					if (!args.phases?.length) return errorResult('Missing required parameter: phases');
					const seenPhases = new Set<string>();
					const seenTasks = new Set<string>();
					state = {
						phases: args.phases.map((input, phaseIndex) => {
							const phaseId = uniqueId(input.id || `p${phaseIndex + 1}`, seenPhases);
							seenPhases.add(phaseId);
							return {
								id: phaseId,
								title: cleanTitle(input.title),
								tasks: (input.tasks || []).map((task, taskIndex) => {
									const taskId = uniqueId(task.id || `t${taskIndex + 1}`, seenTasks);
									seenTasks.add(taskId);
									return normalizeTask(task, taskId);
								}),
							};
						}),
					};
					nextPhase = nextNumberedId(state.phases.map((phase) => phase.id), 'p');
					nextTask = nextNumberedId(state.phases.flatMap((phase) => phase.tasks.map((task) => task.id)), 't');
					return complete('init');
				}

				case 'add_phase': {
					if (!args.phase) return errorResult('Missing required parameter: phase');
					const id = args.phase.id || `p${nextPhase++}`;
					if (state.phases.some((phase) => phase.id === id)) return errorResult(`Phase already exists: ${id}`);
					state.phases.push({ id, title: cleanTitle(args.phase.title), tasks: (args.phase.tasks || []).map((task) => normalizeTask(task, task.id || `t${nextTask++}`)) });
					return complete('add_phase');
				}

				case 'add': {
					if (!args.task) return errorResult('Missing required parameter: task');
					const phase = ensurePhase(args.phaseId);
					const id = args.task.id || `t${nextTask++}`;
					if (findTask(id)) return errorResult(`Task already exists: ${id}`);
					phase.tasks.push(normalizeTask(args.task, id));
					return complete('add');
				}

				case 'start':
				case 'done':
				case 'drop': {
					if (!args.id) return errorResult('Missing required parameter: id');
					const found = findTask(args.id);
					if (!found) return errorResult(`Task not found: ${args.id}`);
					if (args.op === 'start') {
						for (const phase of state.phases) {
							for (const task of phase.tasks) {
								if (task.status === 'in_progress') task.status = 'pending';
							}
						}
						found.task.status = 'in_progress';
					} else if (args.op === 'done') {
						found.task.status = 'done';
					} else {
						found.task.status = 'dropped';
					}
					return complete(args.op);
				}

				case 'update': {
					if (!args.id) return errorResult('Missing required parameter: id');
					const found = findTask(args.id);
					if (!found) return errorResult(`Task not found: ${args.id}`);
					if (args.title) found.task.title = args.title.trim();
					if (args.status) found.task.status = args.status;
					if (args.priority) found.task.priority = args.priority;
					if (args.phaseId && args.phaseId !== found.phase.id) {
						const target = ensurePhase(args.phaseId);
						found.phase.tasks.splice(found.index, 1);
						target.tasks.push(found.task);
					}
					return complete('update');
				}

				case 'move': {
					if (!args.id) return errorResult('Missing required parameter: id');
					const found = findTask(args.id);
					if (!found) return errorResult(`Task not found: ${args.id}`);
					const target = ensurePhase(args.phaseId || found.phase.id);
					found.phase.tasks.splice(found.index, 1);
					const before = args.beforeId ? target.tasks.findIndex((task) => task.id === args.beforeId) : -1;
					const after = args.afterId ? target.tasks.findIndex((task) => task.id === args.afterId) : -1;
					const insertAt = before >= 0 ? before : after >= 0 ? after + 1 : target.tasks.length;
					target.tasks.splice(insertAt, 0, found.task);
					return complete('move');
				}

				case 'view':
					return complete('view');

				case 'clear':
					state = { phases: [] };
					nextPhase = 1;
					nextTask = 1;
					return complete('clear');
			}
		},
	};
}

function loadTodoState(sessionStore?: SessionStore, sessionId?: string): TodoState {
	if (!sessionStore || !sessionId) return { phases: [] };
	const session = sessionStore.get(sessionId);
	if (!session) return { phases: [] };
	let state: TodoState = { phases: [] };
	for (const message of session.messages) {
		if (!isTodoResult(message)) continue;
		const details = message.details as TodoDetails | undefined;
		if (details?.todoState) state = cloneState(details.todoState);
	}
	return state;
}

function isTodoResult(message: Message): message is ToolResultMessage<TodoDetails> {
	return message.role === 'toolResult' && message.toolName === 'todo';
}

function normalizeTodoArgs(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const input: Record<string, unknown> = { ...value };

	if (typeof input.operation === 'string' && typeof input.op !== 'string') input.op = input.operation;
	if (input.op === 'complete') input.op = 'done';
	if (input.op === 'remove') input.op = 'rm';
	if (input.op === 'rm') input.op = 'drop';
	if (typeof input.phase_id === 'string' && typeof input.phaseId !== 'string') input.phaseId = input.phase_id;
	if (typeof input.task_id === 'string' && typeof input.id !== 'string') input.id = input.task_id;

	if (input.op === 'add_phase') {
		const phaseObject = parseObjectString(input.phase);
		const titleObject = parseObjectString(input.title);
		const tasks = Array.isArray(input.tasks) ? input.tasks : Array.isArray(phaseObject?.tasks) ? phaseObject.tasks : undefined;
		if (phaseObject) {
			input.phase = {
				id: typeof phaseObject.id === 'string' ? phaseObject.id : typeof input.id === 'string' ? input.id : undefined,
				title: typeof phaseObject.title === 'string' ? phaseObject.title : typeof input.title === 'string' ? input.title : 'Tasks',
				tasks,
			};
		} else if (titleObject) {
			input.phase = {
				id: typeof titleObject.id === 'string' ? titleObject.id : typeof input.id === 'string' ? input.id : undefined,
				title: typeof titleObject.title === 'string' ? titleObject.title : 'Tasks',
				tasks,
			};
		} else if (typeof input.phase === 'string') {
			input.phase = {
				id: input.phase,
				title: typeof input.title === 'string' ? input.title : input.phase,
				tasks,
			};
		} else if (!input.phase && (typeof input.title === 'string' || Array.isArray(input.tasks))) {
			input.phase = {
				id: typeof input.id === 'string' ? input.id : undefined,
				title: typeof input.title === 'string' ? input.title : 'Tasks',
				tasks,
			};
		}
	}

	if (input.op === 'add') {
		const taskObject = parseObjectString(input.task);
		const titleObject = parseObjectString(input.title);
		if (taskObject) {
			input.task = {
				id: typeof taskObject.id === 'string' ? taskObject.id : typeof input.id === 'string' ? input.id : undefined,
				title: typeof taskObject.title === 'string' ? taskObject.title : typeof input.title === 'string' ? input.title : 'Task',
				status: typeof taskObject.status === 'string' ? taskObject.status : input.status,
				priority: typeof taskObject.priority === 'string' ? taskObject.priority : input.priority,
			};
		} else if (titleObject) {
			input.task = {
				id: typeof titleObject.id === 'string' ? titleObject.id : typeof input.id === 'string' ? input.id : undefined,
				title: typeof titleObject.title === 'string' ? titleObject.title : 'Task',
				status: typeof titleObject.status === 'string' ? titleObject.status : input.status,
				priority: typeof titleObject.priority === 'string' ? titleObject.priority : input.priority,
			};
		} else if (typeof input.task === 'string') {
			input.task = {
				id: input.task,
				title: typeof input.title === 'string' ? input.title : input.task,
				status: input.status,
				priority: input.priority,
			};
		} else if (!input.task && typeof input.title === 'string') {
			input.task = {
				id: typeof input.id === 'string' ? input.id : undefined,
				title: input.title,
				status: input.status,
				priority: input.priority,
			};
		}
	}

	return input;
}

function parseObjectString(value: unknown): Record<string, unknown> | undefined {
	if (isRecord(value)) return value;
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
	try {
		const parsed = JSON.parse(trimmed);
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cleanTitle(title: string): string {
	const parsed = parseObjectString(title);
	if (typeof parsed?.title === 'string') return parsed.title.trim();
	return title.trim();
}

function normalizeTask(input: z.infer<typeof taskInput>, id: string): TodoTask {
	return {
		id,
		title: cleanTitle(input.title),
		status: input.status || 'pending',
		priority: input.priority,
	};
}

function cloneState(state: TodoState): TodoState {
	return { phases: state.phases.map((phase) => ({ ...phase, tasks: phase.tasks.map((task) => ({ ...task })) })) };
}

function summarize(state: TodoState): string {
	const tasks = state.phases.flatMap((phase) => phase.tasks);
	const done = tasks.filter((task) => task.status === 'done').length;
	const active = tasks.filter((task) => task.status === 'in_progress').length;
	const pending = tasks.filter((task) => task.status === 'pending').length;
	const dropped = tasks.filter((task) => task.status === 'dropped').length;
	const parts = [`${done}/${tasks.length} done`];
	if (active) parts.push(`${active} active`);
	if (pending) parts.push(`${pending} pending`);
	if (dropped) parts.push(`${dropped} dropped`);
	return `Todo updated: ${parts.join(' · ')}`;
}

function formatStateForModel(state: TodoState): string {
	if (state.phases.length === 0) return 'No todos.';
	const lines = ['Current todos:'];
	for (const phase of state.phases) {
		lines.push(`- Phase ${phase.id}: ${phase.title}`);
		for (const task of phase.tasks) {
			const priority = task.priority ? ` priority=${task.priority}` : '';
			lines.push(`  - ${task.id} [${task.status}${priority}] ${task.title}`);
		}
	}
	return lines.join('\n');
}

function uniqueId(id: string, seen: Set<string>): string {
	if (!seen.has(id)) return id;
	let suffix = 2;
	while (seen.has(`${id}-${suffix}`)) suffix++;
	return `${id}-${suffix}`;
}

function nextNumberedId(ids: string[], prefix: string): number {
	let max = 0;
	for (const id of ids) {
		if (!id.startsWith(prefix)) continue;
		const value = Number(id.slice(prefix.length));
		if (Number.isInteger(value) && value > max) max = value;
	}
	return max + 1;
}
