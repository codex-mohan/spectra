import type { CmdItem } from './command-types.js';
import type { SessionStore } from '../services/session-store.js';
import { getEffortLabel } from './variant-cycle.js';
import { titlecase } from './utils.js';
import { calculateCost, formatCost, formatTokens, isFreeModel, type Message } from '@mohanscodex/spectra-ai';
import { lookupContextWindow } from './utils/model-config.js';
import { showToast } from './components/toast.js';
import { backgroundTasks } from '../services/background-tasks.js';
import type { AgentCatalog } from '../agents/index.js';
import type { TodoPhase, TodoState, TodoStatus, TodoTask } from './types.js';
import { genId } from './utils.js';

const TODO_SUBCOMMANDS = [
	{ value: 'edit', desc: 'Open todos in $EDITOR (Markdown round-trip)' },
	{ value: 'copy', desc: 'Copy todos as Markdown to clipboard' },
	{ value: 'export', desc: 'Write todos as Markdown to a file (default: TODO.md)' },
	{ value: 'import', desc: 'Replace todos from a Markdown file (default: TODO.md)' },
	{ value: 'append', desc: 'Append a task; phase fuzzy-matched or auto-created' },
	{ value: 'start', desc: 'Mark task in_progress (fuzzy-matched)' },
	{ value: 'done', desc: 'Mark task/phase/all completed (fuzzy-matched)' },
	{ value: 'drop', desc: 'Mark task/phase/all abandoned (fuzzy-matched)' },
	{ value: 'rm', desc: 'Remove task/phase/all (fuzzy-matched)' },
];

const TODO_STATUS_MARK: Record<TodoStatus, string> = {
	pending: ' ',
	in_progress: '>',
	done: 'x',
	dropped: '-',
};

function emptyTodoState(): TodoState {
	return { phases: [] };
}

function cloneTodoState(state: TodoState): TodoState {
	return { phases: state.phases.map((phase) => ({ ...phase, tasks: phase.tasks.map((task) => ({ ...task })) })) };
}

function loadTodoStateFromSession(store: SessionStore, sessionId: string | null): TodoState {
	if (!sessionId) return emptyTodoState();
	const session = store.get(sessionId);
	if (!session) return emptyTodoState();
	let state = emptyTodoState();
	for (const message of session.messages) {
		if (message.role !== 'toolResult' || message.toolName !== 'todo') continue;
		const details = message.details as { todoState?: TodoState } | undefined;
		if (details?.todoState) state = cloneTodoState(details.todoState);
	}
	return state;
}

function todoCounts(state: TodoState): { done: number; total: number } {
	const tasks = state.phases.flatMap((phase) => phase.tasks);
	return { done: tasks.filter((task) => task.status === 'done').length, total: tasks.length };
}

function todoSummary(state: TodoState): string {
	const counts = todoCounts(state);
	return `Todo updated: ${counts.done}/${counts.total} done`;
}

function nextTodoId(state: TodoState, prefix: 'p' | 't'): string {
	const ids = prefix === 'p'
		? state.phases.map((phase) => phase.id)
		: state.phases.flatMap((phase) => phase.tasks.map((task) => task.id));
	let max = 0;
	for (const id of ids) {
		if (!id.startsWith(prefix)) continue;
		const n = Number(id.slice(prefix.length));
		if (Number.isInteger(n) && n > max) max = n;
	}
	return `${prefix}${max + 1}`;
}

function parseTodoObjectString(value: string): Record<string, unknown> | undefined {
	const trimmed = value.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
	try {
		const parsed = JSON.parse(trimmed);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
	} catch {
		return undefined;
	}
}

function cleanTodoTitle(title: string): string {
	const parsed = parseTodoObjectString(title);
	if (typeof parsed?.title === 'string') return parsed.title.trim();
	return title.trim();
}

function normalizeQuery(input: string): string {
	return input.trim().toLowerCase();
}

function scoreMatch(query: string, value: string): number {
	const q = normalizeQuery(query);
	const v = normalizeQuery(value);
	if (!q) return 0;
	if (v === q) return 100;
	if (v.startsWith(q)) return 80;
	if (v.includes(q)) return 60;
	let pos = 0;
	for (const ch of q) {
		pos = v.indexOf(ch, pos);
		if (pos < 0) return 0;
		pos++;
	}
	return 30;
}

function findTodoTask(state: TodoState, query: string): { phase: TodoPhase; task: TodoTask; index: number } | undefined {
	let best: { phase: TodoPhase; task: TodoTask; index: number; score: number } | undefined;
	for (const phase of state.phases) {
		for (let index = 0; index < phase.tasks.length; index++) {
			const task = phase.tasks[index];
			const score = Math.max(scoreMatch(query, task.id), scoreMatch(query, task.title));
			if (score > (best?.score ?? 0)) best = { phase, task, index, score };
		}
	}
	return best && best.score > 0 ? best : undefined;
}

function findTodoPhase(state: TodoState, query: string): { phase: TodoPhase; index: number } | undefined {
	let best: { phase: TodoPhase; index: number; score: number } | undefined;
	for (let index = 0; index < state.phases.length; index++) {
		const phase = state.phases[index];
		const score = Math.max(scoreMatch(query, phase.id), scoreMatch(query, phase.title));
		if (score > (best?.score ?? 0)) best = { phase, index, score };
	}
	return best && best.score > 0 ? best : undefined;
}

function markdownFromTodos(state: TodoState): string {
	if (state.phases.length === 0) return '# Tasks\n\n';
	return state.phases.map((phase) => {
		const lines = [`# ${cleanTodoTitle(phase.title)} <!-- id:${phase.id} -->`, ''];
		for (const task of phase.tasks) {
			lines.push(`- [${TODO_STATUS_MARK[task.status]}] ${cleanTodoTitle(task.title)} <!-- id:${task.id} status:${task.status}${task.priority ? ` priority:${task.priority}` : ''} -->`);
		}
		return lines.join('\n');
	}).join('\n\n');
}

function todosFromMarkdown(markdown: string): TodoState {
	const state = emptyTodoState();
	let current: TodoPhase | undefined;
	for (const rawLine of markdown.split(/\r?\n/)) {
		const heading = rawLine.match(/^#{1,6}\s+(.+?)(?:\s+<!--\s*id:([^-\s]+)\s*-->)?\s*$/);
		if (heading) {
			const title = cleanTodoTitle(heading[1].replace(/<!--.*-->/, '').trim());
			current = { id: heading[2] || nextTodoId(state, 'p'), title, tasks: [] };
			state.phases.push(current);
			continue;
		}
		const item = rawLine.match(/^\s*[-*]\s+\[([ xX>\-])\]\s+(.+?)(?:\s+<!--\s*(.*?)\s*-->)?\s*$/);
		if (!item) continue;
		if (!current) {
			current = { id: nextTodoId(state, 'p'), title: 'Tasks', tasks: [] };
			state.phases.push(current);
		}
		const meta = item[3] || '';
		const id = meta.match(/\bid:([^\s]+)/)?.[1] || nextTodoId(state, 't');
		const statusMeta = meta.match(/\bstatus:([^\s]+)/)?.[1] as TodoStatus | undefined;
		const priority = meta.match(/\bpriority:([^\s]+)/)?.[1] as TodoTask['priority'] | undefined;
		const mark = item[1].toLowerCase();
		const status: TodoStatus = statusMeta || (mark === 'x' ? 'done' : mark === '>' ? 'in_progress' : mark === '-' ? 'dropped' : 'pending');
		current.tasks.push({ id, title: cleanTodoTitle(item[2].replace(/<!--.*-->/, '').trim()), status, priority });
	}
	return state;
}

function addTodoToolMessage(opts: {
	store: SessionStore;
	sessionId: string | null;
	setMessages: (fn: (prev: any[]) => any[]) => void;
	action: string;
	state: TodoState;
}) {
	const summary = todoSummary(opts.state);
	const details = { args: { op: opts.action }, action: opts.action, todoState: cloneTodoState(opts.state), summary };
	if (opts.sessionId) {
		const message: Message = {
			role: 'toolResult',
			toolCallId: `todo-${Date.now()}`,
			toolName: 'todo',
			content: [{ type: 'text', text: summary }],
			details,
			isError: false,
			timestamp: Date.now(),
		};
		opts.store.addMessage(opts.sessionId, message);
	}
	opts.setMessages((prev) => [...prev, {
		id: genId(),
		role: 'tool',
		content: summary,
		meta: `todo(${JSON.stringify({ op: opts.action })})`,
		todoState: cloneTodoState(opts.state),
	}]);
}

async function writeClipboardText(text: string): Promise<void> {
	const clipboard = await import('clipboardy');
	await clipboard.default.write(text);
}

export function buildCmdItems(opts: {
	renderer: { destroy: () => void };
	sessionStore: SessionStore;
	hasModel: boolean;
	selectedModel: string | null;
	provider: string | null;
	mcpCount: number;
	customProviderCount: number;
	messagesLength: number;
	showThinking: boolean;
	showToolCalls: boolean;
	setRoute: (r: 'home' | 'chat') => void;
	setMessages: (fn: (prev: any[]) => any[]) => void;
	setStatus: (s: string) => void;
	setElapsedMs: (v: null) => void;
	setTokPerSec: (v: null) => void;
	setTokenUsage: (v: { input: number; output: number }) => void;
	setShowThinking: (fn: (v: boolean) => boolean) => void;
	setShowToolCalls: (fn: (v: boolean) => boolean) => void;
	setHomeKey: (fn: (k: number) => number) => void;
	setNavKey: (fn: (k: number) => number) => void;
	onAgentSelected: (agent: string) => void;
	setDialogStep: (
		v:
			| { type: 'provider' }
			| { type: 'session-list'; mode?: 'delete' | 'rename' }
			| { type: 'switch-model' }
			| { type: 'manage-providers' }
			| { type: 'doctor'; result: any }
			| { type: 'about' }
			| { type: 'switch-agent' }
			| { type: 'thinking-effort' }
			| { type: 'toggle-mcp' }
			| { type: 'debug' }
			| { type: 'cost' }
			| { type: 'usage' }
			| { type: 'theme' }
			| { type: 'permissions' }
			| { type: 'settings' }
			| { type: 'memory' }
			| { type: 'skills'; defaultTab?: 'pending' | 'all' }
			| null,
	) => void;
	sessionIdRef: { current: string | null };
	onCycleVariant: () => void;
	currentEffort?: string;
	selectedAgent: string;
	agentCatalog: AgentCatalog;
	onSecurityReset?: () => void;
	tokenUsage?: { input: number; output: number };
	elapsedMs?: number | null;
	tokPerSec?: number | null;
	turnCount?: number;
}): CmdItem[] {
	const {
		renderer,
		sessionStore: s,
		sessionIdRef,
		hasModel,
		selectedModel,
		provider,
		mcpCount,
		customProviderCount,
		messagesLength,
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
		onAgentSelected,
		setDialogStep,
		currentEffort,
		selectedAgent,
		agentCatalog,
		onSecurityReset,
		tokenUsage,
		elapsedMs,
		tokPerSec,
		turnCount,
	} = opts;

	const commitTodoState = (action: string, state: TodoState) => {
		addTodoToolMessage({ store: s, sessionId: sessionIdRef.current, setMessages, action, state });
		setRoute('chat');
		const counts = todoCounts(state);
		showToast(`Todo ${counts.done}/${counts.total} done`, 'success');
	};

	const runTodoCommand = async (rawArgs: string) => {
		const args = rawArgs.trim();
		const [op = 'view', ...restParts] = args.split(/\s+/);
		const rest = restParts.join(' ').trim();
		let state = loadTodoStateFromSession(s, sessionIdRef.current);

		if (op === 'view') {
			commitTodoState('view', state);
			return;
		}
		if (op === 'copy') {
			await writeClipboardText(markdownFromTodos(state));
			showToast('Todos copied to clipboard', 'success');
			return;
		}
		if (op === 'export') {
			const { writeFileSync } = await import('node:fs');
			const { resolve } = await import('node:path');
			const file = resolve(rest || 'TODO.md');
			writeFileSync(file, markdownFromTodos(state), 'utf8');
			showToast(`Todos exported to ${file}`, 'success');
			return;
		}
		if (op === 'import') {
			const { readFileSync } = await import('node:fs');
			const { resolve } = await import('node:path');
			const file = resolve(rest || 'TODO.md');
			state = todosFromMarkdown(readFileSync(file, 'utf8'));
			commitTodoState('import', state);
			return;
		}
		if (op === 'edit') {
			const { mkdtempSync, readFileSync, writeFileSync, rmSync } = await import('node:fs');
			const { tmpdir } = await import('node:os');
			const { join } = await import('node:path');
			const { spawnSync } = await import('node:child_process');
			const dir = mkdtempSync(join(tmpdir(), 'spectra-todos-'));
			const file = join(dir, 'TODO.md');
			writeFileSync(file, markdownFromTodos(state), 'utf8');
			const editor = process.env.EDITOR || process.env.VISUAL || (process.platform === 'win32' ? 'notepad' : 'vi');
			const result = spawnSync(editor, [file], { stdio: 'inherit', shell: true });
			if (result.error || result.status !== 0) {
				showToast(`Editor failed: ${result.error?.message || result.status}`, 'error');
				rmSync(dir, { recursive: true, force: true });
				return;
			}
			state = todosFromMarkdown(readFileSync(file, 'utf8'));
			rmSync(dir, { recursive: true, force: true });
			commitTodoState('edit', state);
			return;
		}

		if (op === 'append') {
			if (!rest) {
				showToast('Usage: /todo append [phase:] task', 'warn');
				return;
			}
			const split = rest.match(/^([^:|]+)[:|]\s*(.+)$/);
			const phaseQuery = split?.[1]?.trim();
			const rawTitle = (split?.[2] || rest).trim();
			const taskObject = parseTodoObjectString(rawTitle);
			const title = typeof taskObject?.title === 'string' ? taskObject.title : cleanTodoTitle(rawTitle);
			let phase = phaseQuery ? findTodoPhase(state, phaseQuery)?.phase : state.phases[state.phases.length - 1];
			if (!phase) {
				phase = { id: nextTodoId(state, 'p'), title: phaseQuery ? cleanTodoTitle(phaseQuery) : 'Tasks', tasks: [] };
				state.phases.push(phase);
			}
			phase.tasks.push({
				id: typeof taskObject?.id === 'string' ? taskObject.id : nextTodoId(state, 't'),
				title,
				status: typeof taskObject?.status === 'string' ? taskObject.status as TodoStatus : 'pending',
				priority: typeof taskObject?.priority === 'string' ? taskObject.priority as TodoTask['priority'] : undefined,
			});
			commitTodoState('append', state);
			return;
		}

		if (op === 'start') {
			const found = findTodoTask(state, rest);
			if (!found) {
				showToast(`No matching todo task: ${rest}`, 'warn');
				return;
			}
			for (const phase of state.phases) for (const task of phase.tasks) if (task.status === 'in_progress') task.status = 'pending';
			found.task.status = 'in_progress';
			commitTodoState('start', state);
			return;
		}

		if (op === 'done' || op === 'drop') {
			if (rest === 'all') {
				for (const phase of state.phases) for (const task of phase.tasks) task.status = op === 'done' ? 'done' : 'dropped';
				commitTodoState(op, state);
				return;
			}
			const taskMatch = findTodoTask(state, rest);
			if (taskMatch) {
				taskMatch.task.status = op === 'done' ? 'done' : 'dropped';
				commitTodoState(op, state);
				return;
			}
			const phaseMatch = findTodoPhase(state, rest);
			if (phaseMatch) {
				for (const task of phaseMatch.phase.tasks) task.status = op === 'done' ? 'done' : 'dropped';
				commitTodoState(op, state);
				return;
			}
			showToast(`No matching todo task or phase: ${rest}`, 'warn');
			return;
		}

		if (op === 'rm') {
			if (rest === 'all') {
				state = emptyTodoState();
				commitTodoState('rm', state);
				return;
			}
			const taskMatch = findTodoTask(state, rest);
			if (taskMatch) {
				taskMatch.phase.tasks.splice(taskMatch.index, 1);
				commitTodoState('rm', state);
				return;
			}
			const phaseMatch = findTodoPhase(state, rest);
			if (phaseMatch) {
				state.phases.splice(phaseMatch.index, 1);
				commitTodoState('rm', state);
				return;
			}
			showToast(`No matching todo task or phase: ${rest}`, 'warn');
			return;
		}

		showToast(`Unknown /todo command: ${op}`, 'warn');
	};

	const completeTodoArgs = (rawArgs: string) => {
		const args = rawArgs.trimStart();
		const parts = args.split(/\s+/);
		const op = parts[0] || '';
		const state = loadTodoStateFromSession(s, sessionIdRef.current);
		if (!op || parts.length === 1) {
			const q = op.toLowerCase();
			return TODO_SUBCOMMANDS
				.filter((item) => item.value.includes(q) || item.desc.toLowerCase().includes(q))
				.map((item) => ({ value: item.value, desc: item.desc }));
		}
		const query = parts.slice(1).join(' ');
		if (op === 'start' || op === 'done' || op === 'drop' || op === 'rm') {
			const phaseItems = state.phases
				.filter((phase) => scoreMatch(query, phase.id) || scoreMatch(query, phase.title))
				.map((phase) => ({ value: `${op} ${phase.id}`, desc: `phase · ${phase.title}` }));
			const taskItems = state.phases.flatMap((phase) => phase.tasks
				.filter((task) => scoreMatch(query, task.id) || scoreMatch(query, task.title))
				.map((task) => ({ value: `${op} ${task.id}`, desc: `${task.status} · ${task.title}` })));
			const allItem = op === 'start' ? [] : [{ value: `${op} all`, desc: 'all tasks' }];
			return [...allItem, ...taskItems, ...phaseItems];
		}
		if (op === 'append') {
			return state.phases
				.filter((phase) => scoreMatch(query, phase.id) || scoreMatch(query, phase.title))
				.map((phase) => ({ value: `append ${phase.title}: `, desc: 'append to phase' }));
		}
		return [];
	};

	return [
		// Session
		{
			id: 'new',
			label: 'New Session',
			desc: 'Start fresh',
			cat: 'Session',
			slashName: 'new',
			slashAliases: ['clear'],
			action: () => {
				sessionIdRef.current = null;
				setMessages(() => []);
				setRoute('home');
				setHomeKey((k) => k + 1);
				setNavKey((k) => k + 1);
				setStatus('New session');
				setTimeout(() => setStatus('Ready'), 3000);
				onSecurityReset?.();
			},
		},
		{
			id: 'sessions',
			label: 'List Sessions',
			desc: 'Browse saved sessions',
			cat: 'Session',
			slashName: 'sessions',
			slashAliases: ['resume', 'continue'],
			action: () => {
				setDialogStep({ type: 'session-list' });
			},
		},
		{
			id: 'delete-session',
			label: 'Delete Session',
			desc: 'Remove a saved session',
			cat: 'Session',
			slashName: 'delete-session',
			action: () => {
				setDialogStep({ type: 'session-list', mode: 'delete' });
			},
		},
		{
			id: 'rename-session',
			label: 'Rename Session',
			desc: 'Change session title',
			cat: 'Session',
			slashName: 'rename',
			action: () => {
				setDialogStep({ type: 'session-list', mode: 'rename' });
			},
		},
		{
			id: 'fork-session',
			label: 'Fork Session',
			desc: 'Copy session to new one',
			cat: 'Session',
			slashName: 'fork',
			action: () => {
				const sid = opts.sessionIdRef.current;
				if (!sid) {
					setStatus('No active session');
					return;
				}
				const forked = s.fork(sid);
				if (forked) {
					sessionIdRef.current = forked.id;
					opts.sessionIdRef.current = forked.id;
					setStatus(`Forked: ${forked.title}`);
				}
			},
		},
		{
			id: 'archive-session',
			label: 'Archive Session',
			desc: 'Move session to archive',
			cat: 'Session',
			slashName: 'archive',
			action: () => {
				const sid = opts.sessionIdRef.current;
				if (!sid) {
					setStatus('No active session');
					return;
				}
				s.archive(sid);
				sessionIdRef.current = null;
				opts.sessionIdRef.current = null;
				setMessages(() => []);
				setRoute('home');
				opts.setHomeKey?.((k: number) => k + 1);
				setStatus('Session archived');
			},
		},
		// Conversation
		{
			id: 'clear',
			label: 'Clear',
			desc: 'Clear conversation',
			cat: 'Conversation',
			slashName: 'clear',
			action: () => {
				setMessages(() => []);
				setStatus('Cleared');
			},
		},
		{
			id: 'todo',
			label: 'Todo',
			desc: 'Manage phased session todos',
			cat: 'Conversation',
			slashName: 'todo',
			argCompleter: completeTodoArgs,
			action: ({ args }) => runTodoCommand(args),
		},
		{
			id: 'search',
			label: 'Search Sessions',
			desc: 'Search sessions by query',
			cat: 'Conversation',
			slashName: 'search',
			action: () => {
				setDialogStep({ type: 'session-list' });
			},
		},
		{
			id: 'export',
			label: 'Export Session',
			desc: 'Export session to JSON/Markdown',
			cat: 'Conversation',
			slashName: 'export',
			action: () => {
				const sid = sessionIdRef.current;
				if (!sid) {
					showToast('No active session to export', 'warn');
					return;
				}
				showToast('Export feature coming soon', 'info');
			},
		},
		{
			id: 'history',
			label: 'Show History',
			desc: 'Conversation turn history',
			cat: 'Conversation',
			slashName: 'history',
			action: () => {
				if (messagesLength === 0) {
					showToast('No conversation history', 'warn');
					return;
				}
				showToast(`${messagesLength} messages in conversation`, 'info');
			},
		},
		{
			id: 'compress',
			label: 'Compress Context',
			desc: 'Manually trigger context compaction',
			cat: 'Conversation',
			slashName: 'compress',
			action: async () => {
				if (!opts.sessionIdRef.current) {
					showToast('No active session', 'warn');
					return;
				}
				const sess = opts.sessionStore.get(opts.sessionIdRef.current);
				if (!sess) {
					showToast('Session not found', 'warn');
					return;
				}
				if (sess.messages.length < 4) {
					showToast('Not enough messages to compact', 'info');
					return;
				}
				showToast('Compacting context...', 'info');
				try {
					const { needsCompaction, buildCompactionPrompt, compactMessages } = await import('../services/compaction.js');
					const { stream, initProviders } = await import('@mohanscodex/spectra-ai');
					const { getAuthKey } = await import('./utils/model-config.js');
					initProviders();

					if (!opts.selectedModel || !opts.provider) {
						showToast('No model configured', 'warn');
						return;
					}
					const apiKey = getAuthKey(opts.provider);
					if (!apiKey) {
						showToast('No API key for provider', 'warn');
						return;
					}

					const prompt = buildCompactionPrompt(sess.messages);
					const modelObj = { id: opts.selectedModel, name: opts.selectedModel, provider: opts.provider, api: opts.provider };
					const ctx = { messages: [{ role: 'user' as const, content: prompt, timestamp: Date.now() }] };
					const events = stream(modelObj as any, ctx, { apiKey });

					let summary = '';
					for await (const event of events) {
						if (event.type === 'text_delta' && event.delta) {
							summary += event.delta;
						}
					}
					summary = summary.trim();
					if (!summary || summary.length < 50) {
						showToast('Compaction produced no useful summary', 'warn');
						return;
					}

					const compacted = compactMessages(sess.messages, summary);
					sess.messages = compacted;
					opts.sessionStore.save(sess);
					showToast(`Context compacted (${sess.messages.length} messages)`, 'success');
				} catch (err) {
					showToast(`Compaction failed: ${err instanceof Error ? err.message : String(err)}`, 'error');
				}
			},
		},
		// Provider
		{
			id: 'provider',
			label: 'Connect Provider',
			desc: hasModel ? 'Switch API provider' : 'No provider configured',
			cat: 'Provider',
			slashName: 'connect',
			slashAliases: ['provider'],
			action: () => {
				setDialogStep({ type: 'provider' });
			},
		},
		{
			id: 'manage-providers',
			label: 'Manage Providers',
			desc: `${opts.customProviderCount} custom provider${opts.customProviderCount !== 1 ? 's' : ''}`,
			cat: 'Provider',
			slashName: 'providers',
			action: () => {
				setDialogStep({ type: 'manage-providers' });
			},
		},
		// Model
		{
			id: 'switch-model',
			label: 'Switch Model',
			desc: selectedModel || 'No model selected',
			cat: 'Agent',
			slashName: 'model',
			slashAliases: ['models', 'switch-model'],
			action: () => {
				setDialogStep({ type: 'switch-model' });
			},
		},
		{
			id: 'switch-agent',
			label: 'Switch Agent',
			desc: titlecase(selectedAgent || 'build'),
			cat: 'Agent',
			slashName: 'agent',
			slashAliases: ['agents', 'switch-agent'],
			argCompleter: (args: string) => {
				const q = args.trim().toLowerCase();
				const agents = agentCatalog.primary.map((name) => ({
					value: name,
					desc: agentCatalog.definitions[name]?.description || 'agent mode',
				}));
				return agents.filter((a) => a.value.includes(q) || a.desc.includes(q));
			},
			action: ({ args }) => {
				const agent = args.trim();
				if (!agent) {
					setDialogStep({ type: 'switch-agent' });
					return;
				}
				if (!agentCatalog.primary.includes(agent)) {
					showToast(`Unknown agent mode: ${agent}`, 'warn');
					return;
				}
				onAgentSelected(agent);
				showToast(`Switched to ${titlecase(agent)} agent`, 'info');
			},
		},
		{
			id: 'cycle-effort',
			label: 'Thinking effort cycle',
			desc: `effort: ${getEffortLabel(currentEffort)}`,
			cat: 'Agent',
			slashName: 'effort',
			slashAliases: ['cycle-effort', 'variant'],
			action: () => {
				opts.onCycleVariant();
			},
		},
		{
			id: 'change-effort',
			label: 'Change Thinking effort',
			desc: `set to ${getEffortLabel(currentEffort)}`,
			cat: 'Agent',
			slashName: 'thinking-effort',
			slashAliases: ['change-effort'],
			action: () => {
				setDialogStep({ type: 'thinking-effort' });
			},
		},
		{
			id: 'toggle-mcp',
			label: 'Toggle MCPs',
			desc: `${opts.mcpCount} connected`,
			cat: 'Agent',
			slashName: 'mcp',
			slashAliases: ['toggle-mcp'],
			action: () => {
				setDialogStep({ type: 'toggle-mcp' });
			},
		},
		// Background subagent management
		{
			id: 'background-tasks',
			label: 'Background Tasks',
			desc: 'View and manage background subagent tasks',
			cat: 'Agent',
			slashName: 'bg',
			slashAliases: ['background', 'background-tasks'],
			action: () => {
				const running = backgroundTasks.getRunningForParent(opts.sessionIdRef.current || '');
				if (running.length === 0) {
					showToast('No running background tasks for this session', 'info');
					return;
				}
				for (const task of running) {
					backgroundTasks.promote(task.id);
				}
				showToast(`Promoted ${running.length} task(s) to background`, 'success');
			},
		},
		// Memory
		{
			id: 'memory',
			label: 'Memory',
			desc: 'View and manage persistent memory',
			cat: 'Agent',
			slashName: 'memory',
			argCompleter: (args: string) => {
				const parts = args.trim().split(/\s+/);
				if (parts.length <= 1) {
					const q = (parts[0] || '').toLowerCase();
					const actions = [
						{ value: 'read', desc: 'show memory entries' },
						{ value: 'add', desc: 'append a new entry' },
						{ value: 'replace', desc: 'replace an entry' },
						{ value: 'remove', desc: 'delete an entry' },
						{ value: 'list', desc: 'list memory scopes' },
					];
					return actions.filter((a) => a.value.includes(q) || a.desc.includes(q));
				}
				const q = (parts[1] || '').toLowerCase();
				const scopes = [
					{ value: 'memory', desc: 'agent notes' },
					{ value: 'user', desc: 'user profile facts' },
					{ value: 'project', desc: 'project context' },
				];
				return scopes.filter((s) => s.value.includes(q) || s.desc.includes(q));
			},
			action: () => {
				setDialogStep({ type: 'memory' });
			},
		},
		{
			id: 'skills',
			label: 'Skills',
			desc: 'Review pending and saved skills',
			cat: 'Agent',
			slashName: 'skills',
			argCompleter: async (args: string) => {
				const q = args.trim().toLowerCase();
				const builtins = [
					{ value: 'pending', desc: 'review learned skills' },
					{ value: 'browse', desc: 'view saved skills' },
				];
				try {
					const { loadAllEvolvingSkills } = await import('../services/skill-store.js');
					const { discoverSkills } = await import('@mohanscodex/spectra-agent');
					const evolving = await loadAllEvolvingSkills();
					const bundled = await discoverSkills();
					const skills = [
						...evolving.map((s) => ({ value: s.name, desc: s.description || 'saved skill' })),
						...[...bundled.values()].map((s) => ({ value: s.name, desc: s.description || s.whenToUse || 'bundled skill' })),
					];
					const unique = new Map<string, { value: string; desc: string }>();
					for (const item of [...builtins, ...skills]) unique.set(item.value, item);
					return [...unique.values()].filter((n) => !q || n.value.toLowerCase().includes(q) || n.desc.toLowerCase().includes(q));
				} catch {
					return builtins.filter((n) => !q || n.value.includes(q) || n.desc.includes(q));
				}
			},
			action: ({ args }) => {
				const trimmed = args?.trim() ?? '';
				// /skills browse → open saved tab; /skills pending or no args → pending tab
				const defaultTab = trimmed === 'browse' ? 'all' : 'pending';
				setDialogStep({ type: 'skills', defaultTab });
			},
		},
		// Display
		{
			id: 'toggle-thinking',
			label: `${showThinking ? 'Hide' : 'Show'} Thinking`,
			desc: showThinking ? 'Hide thinking blocks' : 'Show thinking blocks',
			cat: 'Display',
			slashName: 'thinking',
			slashAliases: ['toggle-thinking'],
			action: () => {
				setShowThinking((v) => !v);
			},
		},
		{
			id: 'toggle-tools',
			label: `${showToolCalls ? 'Hide' : 'Show'} Tool Calls`,
			desc: showToolCalls ? 'Hide tool call indicators' : 'Show tool call indicators',
			cat: 'Display',
			slashName: 'tools',
			slashAliases: ['toggle-tools'],
			action: () => {
				setShowToolCalls((v) => !v);
			},
		},
		// Navigation
		{
			id: 'home',
			label: 'Go Home',
			desc: 'Return to home',
			cat: 'Navigation',
			slashName: 'home',
			action: () => {
				setRoute('home');
			},
		},
		// Observability
		{
			id: 'cost',
			label: 'Show Cost',
			desc: 'Estimated session cost',
			cat: 'Observability',
			slashName: 'cost',
			action: () => {
				setDialogStep({ type: 'cost' });
			},
		},
		{
			id: 'usage',
			label: 'Show Usage',
			desc: 'Coding plan quota windows',
			cat: 'Observability',
			slashName: 'usage',
			action: () => {
				setDialogStep({ type: 'usage' });
			},
		},
		{
			id: 'tokens',
			label: 'Show Tokens',
			desc: 'Token usage breakdown',
			cat: 'Observability',
			slashName: 'tokens',
			action: () => {
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				const total = input + output;
				if (total === 0) {
					showToast('No token usage yet', 'info');
					return;
				}
				const ctxMax = selectedModel ? lookupContextWindow(selectedModel, provider) : null;
				const pct = ctxMax ? Math.round((total / ctxMax) * 100) : null;
				const ctxStr = pct != null ? ` · ${pct}% of ${formatTokens(ctxMax!)} ctx` : '';
				showToast(`↑${formatTokens(input)} input · ↓${formatTokens(output)} output${ctxStr}`, 'info');
			},
		},
		{
			id: 'session-stats',
			label: 'Session Stats',
			desc: 'Current session turns, messages, tokens, and runtime metrics',
			cat: 'Observability',
			slashName: 'stats',
			action: () => {
				const parts = [
					`Turns: ${turnCount ?? 0}`,
					`Messages: ${messagesLength}`,
					`Duration: ${elapsedMs != null ? `${(elapsedMs / 1000).toFixed(1)}s` : 'n/a'}`,
					`Rate: ${tokPerSec != null && tokPerSec > 0 ? `${tokPerSec.toFixed(1)} tok/s` : 'n/a'}`,
				];
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				const total = input + output;
				parts.push(total > 0 ? `Tokens: ↑${formatTokens(input)} ↓${formatTokens(output)}` : 'Tokens: none');
				if (total > 0 && selectedModel && !isFreeModel(selectedModel)) {
					const cost = calculateCost(selectedModel, { input, output });
					parts.push(`Cost: ${formatCost(cost.total)}`);
				} else {
					parts.push('Cost: n/a');
				}
				showToast(parts.join(' · '), 'info');
			},
		},
		{
			id: 'context',
			label: 'Show Context',
			desc: 'Context window usage',
			cat: 'Observability',
			slashName: 'context',
			action: () => {
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				const total = input + output;
				if (total === 0) {
					showToast('No token usage yet', 'info');
					return;
				}
				if (!selectedModel) {
					showToast(`Tokens used: ${formatTokens(total)}`, 'info');
					return;
				}
				const ctxMax = lookupContextWindow(selectedModel, provider);
				if (!ctxMax) {
					showToast(`Tokens used: ${formatTokens(total)} (context window unknown for ${selectedModel})`, 'info');
					return;
				}
				const remaining = Math.max(0, ctxMax - total);
				const pct = Math.round((total / ctxMax) * 100);
				const bar = pct > 90 ? '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) : '';
				showToast(`${formatTokens(total)} / ${formatTokens(ctxMax)} (${pct}%) · ${formatTokens(remaining)} remaining${bar ? ' ' + bar : ''}`, 'info');
			},
		},
		{
			id: 'system-stats',
			label: 'System Stats',
			desc: 'Runtime configuration, model, provider, and connected services',
			cat: 'Observability',
			slashName: 'system-stats',
			action: () => {
				const effort = currentEffort ? getEffortLabel(currentEffort) : 'default';
				const parts = [
					`Model: ${selectedModel ?? 'none'}`,
					`Provider: ${provider ?? 'none'}`,
					`Agent: ${selectedAgent || 'none'}`,
					`MCPs: ${mcpCount}`,
					`Custom providers: ${customProviderCount}`,
					`Thinking: ${effort}`,
					`Display: thinking ${showThinking ? 'on' : 'off'}, tools ${showToolCalls ? 'on' : 'off'}`,
				];
				if (!hasModel) parts.push('Model not configured');
				showToast(parts.join(' · '), 'info');
			},
		},
		// Git
		{
			id: 'commit',
			label: 'Commit Changes',
			desc: 'Stage and commit with AI message',
			cat: 'Git',
			slashName: 'commit',
			action: () => {
				showToast('AI commit feature coming soon', 'info');
			},
		},
		{
			id: 'review',
			label: 'Review Changes',
			desc: 'Review uncommitted changes',
			cat: 'Git',
			slashName: 'review',
			action: () => {
				showToast('Review feature coming soon', 'info');
			},
		},
		// Config
		{
			id: 'theme',
			label: 'Switch Theme',
			desc: 'Change color theme',
			cat: 'Config',
			slashName: 'theme',
			action: () => {
				showToast('Theme switching is not implemented yet', 'info');
			},
		},
		{
			id: 'permissions',
			label: 'Permissions',
			desc: 'View/edit tool permissions',
			cat: 'Config',
			slashName: 'permissions',
			action: () => {
				showToast('Permissions UI is not implemented yet', 'info');
			},
		},
		{
			id: 'settings',
			label: 'Settings',
			desc: 'Open settings panel',
			cat: 'Config',
			slashName: 'settings',
			action: () => {
				setDialogStep({ type: 'settings' });
			},
		},
		// System
		{
			id: 'doctor',
			label: 'Doctor',
			desc: 'Run health check',
			cat: 'System',
			slashName: 'doctor',
			action: () => {
				setDialogStep({ type: 'doctor', result: null } as any);
				import('../commands/doctor.js').then((m) =>
					m.runDoctor().then((result: any) => {
						setDialogStep({ type: 'doctor', result } as any);
					}),
				);
			},
		},
		{
			id: 'debug',
			label: 'Debug',
			desc: 'System information',
			cat: 'System',
			slashName: 'debug',
			action: () => {
				setDialogStep({ type: 'debug' });
			},
		},
		{
			id: 'about',
			label: 'About',
			desc: 'Version info',
			cat: 'System',
			slashName: 'about',
			action: () => {
				setDialogStep({ type: 'about' });
			},
		},
		{
			id: 'help',
			label: 'Help',
			desc: 'Keyboard shortcuts',
			cat: 'System',
			slashName: 'help',
			action: () => {
				setStatus('Esc quit · Tab agents · Ctrl+P palette · Ctrl+L clear');
				setTimeout(() => setStatus('Ready'), 4000);
			},
		},
		{
			id: 'quit',
			label: 'Quit',
			desc: 'Exit',
			cat: 'System',
			slashName: 'exit',
			slashAliases: ['quit', 'q'],
			action: () => renderer.destroy(),
		},
	];
}

export function collectSlashNames(items: CmdItem[]): Set<string> {
	const names = new Set<string>();
	for (const item of items) {
		if (item.slashName) names.add(item.slashName);
		if (item.slashAliases) {
			for (const alias of item.slashAliases) names.add(alias);
		}
	}
	return names;
}
