import { memo, useState } from 'react';
import { c, mdStyle, mdStyleMuted } from '../theme.js';
import type { ChatMessage, ContentBlock, TodoPhase, TodoState, TodoStatus } from '../types.js';
import type { PromptAttachment } from '../prompt-bar.js';
import stripAnsi from 'strip-ansi';
import { basename, isAbsolute, relative } from 'path';
import clipboard from 'clipboardy';
import { filetype } from '../utils/filetype.js';
import { formatAttachmentBadge, formatAttachmentMetadata, getDisplayIcon, getFileIcon, getFileVisual } from '../utils/file-visuals.js';
import { askToolDetailsSchema, type AskQuestionResult } from '../../tools/ask.js';
import { showToast } from './toast.js';
import { prepareMarkdown } from '../utils/markdown-render.js';
import { iconForJob } from '../utils/icons.js';

// OpenCode-style SplitBorder — only vertical bar on the left
const SB = {
	vertical: '┃',
	topLeft: '',
	bottomLeft: '',
	topRight: '',
	bottomRight: '',
	horizontal: ' ',
	bottomT: '',
	topT: '',
	cross: '',
	leftT: '',
	rightT: '',
};

function ToolTitleRow({ icon, toolName, toolColor, fileName }: {
	icon: string; toolName: string; toolColor: string; fileName?: string;
}) {
	const fileVisual = fileName ? getFileVisual({ filename: fileName, mime: 'application/octet-stream' }) : undefined;
	const fileIcon = fileName ? getDisplayIcon({ filename: fileName, mime: 'application/octet-stream' }) : undefined;
	return (
		<box flexDirection="row" gap={0} flexShrink={1} overflow="hidden">
			<text fg={toolColor} flexShrink={0}>{icon} {toolName}</text>
			{fileName && fileVisual && fileIcon ? (
				<>
					<text fg={fileVisual.color} flexShrink={0}> {fileIcon}</text>
					<text fg={fileVisual.color} wrapMode="none" truncate flexShrink={1}> {fileName}</text>
				</>
			) : null}
		</box>
	);
}

const MAX_SHELL_LINES = 10;
const MAX_GENERIC_LINES = 3;

function DiffContent(props: { text: string; filePath?: string }) {
	const ft = props.filePath ? filetype(props.filePath) : undefined;
	return (
		<diff
			diff={props.text}
			view="unified"
			syntaxStyle={mdStyle}
			{...(ft ? { filetype: ft } : {})}
			showLineNumbers={true}
			fg={c.text}
			addedBg={c.diffAddBg}
			removedBg={c.diffRemoveBg}
			contextBg={c.diffContextBg}
			addedSignColor={c.diffAddSign}
			removedSignColor={c.diffRemoveSign}
			lineNumberFg={c.diffLineNumber}
			lineNumberBg={c.diffLineNumberBg}
			addedLineNumberBg={c.diffAddLineNumberBg}
			removedLineNumberBg={c.diffRemoveLineNumberBg}
			wrapMode="none"
		/>
	);
}

function InlineTool(props: { icon: string; title: string; titleContent?: any; meta?: string; color?: string; titleColor?: string; marginTop?: number; status?: 'success' | 'error' }) {
	const statusIcon = props.status === 'success' ? ' ✓' : props.status === 'error' ? ' ✗' : '';
	const statusColor = props.status === 'success' ? c.success : props.status === 'error' ? c.error : undefined;
	return (
		<box flexDirection="row" paddingLeft={3} marginTop={props.marginTop ?? 0} overflow="hidden">
			<box flexDirection="row" flexShrink={1} overflow="hidden">
				{props.titleContent || <><text fg={props.titleColor || c.tool} flexShrink={0}>{props.icon} </text><text fg={props.titleColor || c.tool} wrapMode="none" truncate flexShrink={1}>{props.title}</text></>}
			</box>
			{props.meta ? <text fg={props.color || c.dim} flexShrink={0} wrapMode="none"> {props.meta}</text> : null}
			{statusIcon ? <text fg={statusColor} flexShrink={0} wrapMode="none">{statusIcon}</text> : null}
		</box>
	);
}

function BlockTool(props: { title: string; titleContent?: any; titleColor?: string; borderColor?: string; children: any; marginTop?: number; status?: 'success' | 'error' }) {
	const statusIcon = props.status === 'success' ? ' ✓' : props.status === 'error' ? ' ✗' : '';
	const statusColor = props.status === 'success' ? c.success : props.status === 'error' ? c.error : undefined;
	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={props.marginTop ?? 1}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={props.borderColor || c.tool}
		>
			<box flexDirection="row" paddingLeft={1} gap={0} overflow="hidden">
				<box flexDirection="row" flexGrow={1} flexShrink={1} overflow="hidden">
					{props.titleContent || <text fg={props.titleColor || c.tool} wrapMode="none" truncate flexShrink={1}>{props.title}</text>}
				</box>
				{statusIcon ? <text fg={statusColor} flexShrink={0} wrapMode="none">{statusIcon}</text> : null}
			</box>
			<box paddingLeft={2}>{props.children}</box>
		</box>
	);
}

function TruncatedContent(props: { text: string; maxLines: number; color?: string }) {
	const [expanded, setExpanded] = useState(false);
	const lines = props.text.split('\n');
	const overflow = lines.length > props.maxLines;
	const display = expanded || !overflow ? props.text : lines.slice(0, props.maxLines).join('\n') + '\n…';
	return (
		<box flexDirection="column" onMouseDown={overflow ? () => setExpanded(!expanded) : undefined}>
			<text fg={props.color || c.text}>{display}</text>
			{overflow ? <text fg={c.dim}>{expanded ? 'click to collapse' : 'click to expand'}</text> : null}
		</box>
	);
}

function formatValidationError(output: string): string[] | null {
	if (!output.startsWith('Argument validation failed:') && !output.includes('Invalid arguments for tool')) return null;
	const issuesStart = output.indexOf('[');
	if (issuesStart < 0) return [output.split('\n')[0]];
	try {
		const issues = JSON.parse(output.slice(issuesStart)) as Array<{ path?: unknown[]; message?: string; expected?: string; received?: string }>;
		return issues.map((issue) => {
			const path = issue.path?.length ? issue.path.join('.') : 'arguments';
			if (issue.expected && issue.received) return `${path}: expected ${issue.expected}, got ${issue.received}`;
			return `${path}: ${issue.message || 'invalid value'}`;
		});
	} catch {
		return [output.split('\n')[0]];
	}
}

function ValidationErrorTool({ toolName, output, marginTop }: { toolName: string; output: string; marginTop: number }) {
	const lines = formatValidationError(output) || ['Invalid arguments'];
	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={c.error}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={c.error}>{toolName}</text>
				<text fg={c.error}>invalid arguments ✕</text>
			</box>
			<box flexDirection="column" paddingLeft={2}>
				{lines.map((line, i) => <text key={`validation-${i}`} fg={c.error}>{line}</text>)}
				{toolName === 'todo' ? (
					<text fg={c.dim}>Example: {"{\"op\":\"add_phase\",\"phase\":{\"id\":\"phase-2\",\"title\":\"Advanced Operations\",\"tasks\":[]}}"}</text>
				) : null}
			</box>
		</box>
	);
}

function displayTodoTitle(title: string): string {
	const trimmed = title.trim();
	if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return title;
	try {
		const parsed = JSON.parse(trimmed) as unknown;
		if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && typeof (parsed as { title?: unknown }).title === 'string') {
			return (parsed as { title: string }).title;
		}
	} catch {}
	return title;
}


function statusMark(status: TodoStatus): string {
	if (status === 'done') return '✓';
	if (status === 'in_progress') return '•';
	if (status === 'dropped') return '✕';
	return '□';
}

function statusColor(status: TodoStatus): string {
	if (status === 'done') return c.success;
	if (status === 'in_progress') return c.warn;
	if (status === 'dropped') return c.error;
	return c.dim;
}

function roman(n: number): string {
	const numerals: Array<[number, string]> = [
		[10, 'X'],
		[9, 'IX'],
		[5, 'V'],
		[4, 'IV'],
		[1, 'I'],
	];
	let value = n;
	let out = '';
	for (const [amount, label] of numerals) {
		while (value >= amount) {
			out += label;
			value -= amount;
		}
	}
	return out || String(n);
}

function countTasks(state: TodoState): { total: number; done: number } {
	const tasks = state.phases.flatMap((phase) => phase.tasks);
	return { total: tasks.length, done: tasks.filter((task) => task.status === 'done').length };
}

function TodoPhaseView({ phase, index }: { phase: TodoPhase; index: number }) {
	return (
		<box flexDirection="column">
			<box flexDirection="row" gap={1}>
				<text fg={c.accent} attributes={1}>{roman(index + 1)}.</text>
				<text fg={c.accent} attributes={1}>{displayTodoTitle(phase.title)}</text>
			</box>
			{phase.tasks.map((task, taskIndex) => {
				const last = taskIndex === phase.tasks.length - 1;
				const color = statusColor(task.status);
				return (
					<box key={task.id} flexDirection="row" paddingLeft={2} gap={0}>
						<text fg={c.dim}>{last ? '└─ ' : '├─ '}</text>
						<text fg={color}>{statusMark(task.status)}</text>
						<text fg={task.status === 'done' || task.status === 'dropped' ? c.dim : c.text}> {displayTodoTitle(task.title)}</text>
						<text fg={c.dim}> </text>
						<text fg={c.subtext}>#{task.id}</text>
					</box>
				);
			})}
		</box>
	);
}

function TodoToolView({ state, marginTop }: { state: TodoState; marginTop: number }) {
	const counts = countTasks(state);
	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={c.accent}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={c.accent}>☑</text>
				<text fg={c.accent} attributes={1}>Todo</text>
				<text fg={c.dim}>{counts.done}/{counts.total} tasks</text>
			</box>
			<box flexDirection="column" paddingLeft={2}>
				{state.phases.length === 0 ? (
					<text fg={c.dim}>No todos</text>
				) : (
					state.phases.map((phase, index) => <TodoPhaseView key={phase.id} phase={phase} index={index} />)
				)}
			</box>
		</box>
	);
}

function normalizeAskResults(details: Record<string, unknown> | undefined): AskQuestionResult[] {
	const parsed = askToolDetailsSchema.safeParse(details);
	return parsed.success ? parsed.data.results : [];
}

function AskToolView({ details, marginTop }: { details: Record<string, unknown>; marginTop: number }) {
	const results = normalizeAskResults(details);
	return (
		<BlockTool title="? Ask" titleColor={c.accent} borderColor={c.accent} marginTop={marginTop} status="success">
			<box flexDirection="column" gap={1}>
				{results.map((result) => {
					const selected = new Set(result.selectedOptions);
					return (
						<box key={result.id} flexDirection="column">
							<text fg={c.text} attributes={1}>{result.question}</text>
							{result.options.map((option) => {
								const active = selected.has(option);
								const marker = result.multi ? (active ? '☑' : '☐') : (active ? '●' : '○');
								return (
									<box key={option} flexDirection="row" paddingLeft={1} gap={1}>
										<text fg={active ? c.success : c.dim}>{marker}</text>
										<text fg={active ? c.text : c.dim}>{option}</text>
									</box>
								);
							})}
							{result.customInput !== undefined && (
								<box flexDirection="row" paddingLeft={1} gap={1}>
									<text fg={c.success}>↳</text>
									<text fg={c.text}>{result.customInput}</text>
								</box>
							)}
						</box>
					);
				})}
			</box>
		</BlockTool>
	);
}

const MEMORY_SCOPES: Record<string, { icon: string; label: string; color: string }> = {
	memory: { icon: '🧠', label: 'Memory', color: c.accent },
	user: { icon: '👤', label: 'User', color: c.info },
	project: { icon: '📁', label: 'Project', color: c.success },
};

function parseMemoryOutput(output: string): { entries: string[]; used: number; limit: number } | null {
	const usageMatch = output.match(/(\d+)\/(\d+)\s*chars/);
	if (!usageMatch) return null;
	const used = parseInt(usageMatch[1], 10);
	const limit = parseInt(usageMatch[2], 10);
	const colonIdx = output.indexOf(':\n\n');
	if (colonIdx !== -1) {
		const entries = output.slice(colonIdx + 3).split('\n\n').map((e) => e.trim()).filter(Boolean);
		return { entries, used, limit };
	}
	return { entries: [], used, limit };
}

function MemoryToolView({ args, output, isError, marginTop }: { args: Record<string, unknown>; output: string; isError: boolean; marginTop: number }) {
	const target = String(args.target || 'memory');
	const action = String(args.action || 'read');
	const scope = MEMORY_SCOPES[target] || MEMORY_SCOPES.memory;
	const borderColor = isError ? c.error : scope.color;
	const statusIcon = isError ? '✗' : '✓';
	const parsed = parseMemoryOutput(output);

	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={borderColor}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={borderColor}>{scope.icon}</text>
				<text fg={borderColor} attributes={1}>{scope.label}</text>
				<text fg={c.dim}>· {action}</text>
				<text fg={isError ? c.error : scope.color}> {statusIcon}</text>
			</box>
			<box flexDirection="column" paddingLeft={2} gap={0}>
				{action === 'read' && parsed && parsed.entries.length > 0 ? (
					parsed.entries.slice(0, 8).map((entry, i) => (
						<box key={i} flexDirection="row" gap={1}>
							<text fg={c.dim}>▸</text>
							<text fg={c.text}>{entry.length > 80 ? entry.slice(0, 77) + '...' : entry}</text>
						</box>
					))
				) : action === 'list' && parsed ? (
					<text fg={c.dim}>{parsed.entries.length > 0 ? `${parsed.entries.length} entries` : output}</text>
				) : isError ? (
					<text fg={c.error}>{output}</text>
				) : action === 'add' ? (
					<text fg={c.text}>{args.entry ? String(args.entry).slice(0, 80) : output}</text>
				) : action === 'replace' ? (
					<text fg={c.text}>{args.entry ? String(args.entry).slice(0, 60) : '...'}</text>
				) : action === 'remove' ? (
					<text fg={c.dim}>{args.entry ? String(args.entry).slice(0, 60) : ''}</text>
				) : null}
			</box>
			{parsed && (
				<box flexDirection="row" paddingLeft={1} gap={1}>
					<text fg={c.dim}>{parsed.entries.length} entries · {parsed.used}/{parsed.limit} chars</text>
				</box>
			)}
		</box>
	);
}

const SKILL_COLOR = '#C4A0E0';

const MAX_SEARCH_SOURCES = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function WebSearchToolView(props: {
	args: Record<string, unknown>;
	details: unknown;
	output: string;
	isError: boolean;
	streaming: boolean;
	marginTop: number;
}) {
	const details = isRecord(props.details) ? props.details : {};
	const results = Array.isArray(details.results) ? details.results.filter(isRecord) : [];
	const notes = Array.isArray(details.notes) ? details.notes.filter((note): note is string => typeof note === 'string') : [];
	const provider = typeof details.provider === 'string' ? details.provider : '';
	const elapsed = typeof details.elapsedMs === 'number' ? details.elapsedMs : undefined;
	const query = String(props.args.query ?? '');
	const [expanded, setExpanded] = useState(false);

	const borderColor = props.isError ? c.error : c.info;
	const visible = expanded ? results : results.slice(0, MAX_SEARCH_SOURCES);
	const hidden = Math.max(0, results.length - visible.length);
	const pending = props.streaming && !props.output;

	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={props.marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={borderColor}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={borderColor}>{props.isError ? '!' : '⌕'}</text>
				<text fg={borderColor} attributes={1}>Web search</text>
				<text fg={c.text} overflow="hidden" wrapMode="none" flexShrink={1}>{query ? `"${query}"` : ''}</text>
				<text fg={c.dim}>· {results.length} results</text>
				{props.isError ? <text fg={c.error}>✗</text> : pending ? null : <text fg={c.success}>✓</text>}
			</box>

			<box flexDirection="column" paddingLeft={2} gap={0}>
				{pending ? (
					<text fg={c.accent}>searching…</text>
				) : props.isError ? (
					<text fg={c.error}>{props.output || 'Search failed'}</text>
				) : results.length === 0 ? (
					<text fg={c.dim}>{notes.length > 0 ? 'No results after relaxing query constraints' : 'No results'}</text>
				) : (
					visible.map((result, index) => {
						const title = typeof result.title === 'string' ? result.title : '';
						const url = typeof result.url === 'string' ? result.url : '';
						const snippet = typeof result.snippet === 'string' ? result.snippet : '';
						const age = typeof result.publishedAt === 'string' ? result.publishedAt : '';
						return (
							<box key={`${url}-${index}`} flexDirection="column" marginTop={index === 0 ? 0 : 1}>
								<box flexDirection="row" gap={1}>
									<text fg={c.dim}>{index + 1}</text>
									<text fg={c.text} overflow="hidden" wrapMode="none">{title || url}</text>
									{age ? <text fg={c.dim}>· {age}</text> : null}
								</box>
								<box flexDirection="row" paddingLeft={2}>
									<text fg={c.dim} overflow="hidden" wrapMode="none">{url}</text>
								</box>
								{snippet ? (
									<box paddingLeft={2}>
										<text fg={c.dim} wrapMode="none">{snippet}</text>
									</box>
								) : null}
							</box>
						);
					})
				)}
				{hidden > 0 ? (
					<box marginTop={1} onMouseDown={() => setExpanded(true)}>
						<text fg={c.dim}>… {hidden} more sources · click to expand</text>
					</box>
				) : expanded && results.length > MAX_SEARCH_SOURCES ? (
					<box marginTop={1} onMouseDown={() => setExpanded(false)}>
						<text fg={c.dim}>click to collapse</text>
					</box>
				) : null}
				{notes.map((note, index) => (
					<text key={`note-${index}`} fg={c.warn}>Note: {note}</text>
				))}
			</box>

			{(provider || elapsed !== undefined) ? (
				<box flexDirection="row" paddingLeft={1} gap={1}>
					{provider ? <text fg={c.dim}>{provider}</text> : null}
					{provider && elapsed !== undefined ? <text fg={c.dim}>·</text> : null}
					{elapsed !== undefined ? <text fg={c.dim}>{elapsed >= 1000 ? `${(elapsed / 1000).toFixed(1)}s` : `${elapsed}ms`}</text> : null}
				</box>
			) : null}
		</box>
	);
}

/** Dedicated card for the `lsp` tool: grouped diagnostics, clickable locations, diffs. */
function LspToolView(props: {
	args: Record<string, unknown>;
	details: unknown;
	output: string;
	isError: boolean;
	streaming: boolean;
	marginTop: number;
}) {
	const action = String(props.args.action ?? 'lsp');
	const rawFile = typeof props.args.file === 'string' ? props.args.file : '';
	const file = rawFile && isAbsolute(rawFile) ? relative(process.cwd(), rawFile) : rawFile;
	const newName = typeof props.args.new_name === 'string' ? props.args.new_name : '';
	const [expanded, setExpanded] = useState(false);
	const lines = props.output.split('\n').filter((line) => line.length > 0);

	const locationEntries = lines
		.map((line) => {
			const match = /^(.*?):(\d+):(\d+)$/.exec(line);
			return match ? { file: match[1], line: Number(match[2]), column: Number(match[3]) } : null;
		})
		.filter((entry): entry is { file: string; line: number; column: number } => entry !== null);

	const diagnosticEntries = lines
		.map((line) => {
			const match = /^(.*?):(\d+):(\d+)\s+(error|warning|info|hint):\s*(.*)$/i.exec(line);
			return match
				? { file: match[1], line: Number(match[2]), column: Number(match[3]), level: match[4].toLowerCase(), message: match[5] }
				: null;
		})
		.filter((entry): entry is { file: string; line: number; column: number; level: string; message: string } => entry !== null);

	const severityRank: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };
	const sortedDiagnostics = [...diagnosticEntries].sort((a, b) => (
		(severityRank[a.level] ?? 4) - (severityRank[b.level] ?? 4) || a.line - b.line
	));
	const counts = diagnosticEntries.reduce<Record<string, number>>((totals, entry) => {
		totals[entry.level] = (totals[entry.level] ?? 0) + 1;
		return totals;
	}, {});
	const summary = Object.entries(counts).map(([level, count]) => `${count} ${level}${count === 1 ? '' : 's'}`).join(', ');
	const server = props.details && typeof props.details === 'object' && 'server' in props.details && typeof props.details.server === 'string'
		? props.details.server
		: '';

	const looksLikeDiff = /^--- |\n--- |^Index: |\nIndex: /.test(props.output);
	const cleanDiagnostics = action === 'diagnostics' && props.output.trim() === 'No diagnostics.';
	const noResults = props.output.trim() === 'No locations found.' || props.output.trim() === 'No symbols.';

	const copy = (line: string) => {
		try {
			clipboard.writeSync(line);
			showToast(`Copied ${line}`, 'success');
		} catch {
			// Clipboard may be unavailable over SSH.
		}
	};

	if (!props.isError && !props.streaming && (cleanDiagnostics || noResults)) {
		const label = cleanDiagnostics ? 'clean' : 'no results';
		return (
			<InlineTool
				icon="⌕"
				title={`lsp ${action}${file ? ` ${file}` : ''}`}
				titleContent={(
					<box flexDirection="row" gap={1}>
						<text fg={c.info}>⌕ lsp {action}</text>
						{file ? <text fg={c.dim}>{file}</text> : null}
						<text fg={c.dim}>· {label}</text>
					</box>
				)}
				color={c.info}
				marginTop={props.marginTop}
				status="success"
			/>
		);
	}

	const visible = expanded ? lines : lines.slice(0, 12);
	const hidden = Math.max(0, lines.length - visible.length);
	const pending = props.streaming && !props.output;
	const target = file || (rawFile === '*' ? '*' : '');
	const headerMeta = summary || (locationEntries.length > 0 ? `${locationEntries.length} location${locationEntries.length === 1 ? '' : 's'}` : '');

	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={props.marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={props.isError ? c.error : c.info}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={props.isError ? c.error : c.info}>{props.isError ? '!' : '⌕'}</text>
				<text fg={props.isError ? c.error : c.info} attributes={1}>LSP</text>
				<text fg={c.text}>{action}</text>
				{target ? <text fg={c.dim}>· {target}</text> : null}
				{newName ? <text fg={c.warn}>→ {newName}</text> : null}
				{headerMeta ? <text fg={c.dim}>· {headerMeta}</text> : null}
				{props.streaming ? <text fg={c.dim}>· preview</text> : null}
				{props.isError ? <text fg={c.error}>✗</text> : pending ? null : <text fg={c.success}>✓</text>}
			</box>

			<box flexDirection="column" paddingLeft={2}>
				{pending ? (
					<text fg={c.accent}>querying server…</text>
				) : props.isError ? (
					<text fg={c.error}>{props.output || 'LSP request failed'}</text>
				) : action === 'hover' && props.output ? (
					<markdown
						content={prepareMarkdown(props.output)}
						syntaxStyle={mdStyle}
						conceal={true}
						width="100%"
						tableOptions={{ style: 'grid', borders: true, borderStyle: 'single' }}
					/>
				) : sortedDiagnostics.length > 0 ? (
					<>
						{sortedDiagnostics.slice(0, expanded ? sortedDiagnostics.length : 8).map((entry, index) => {
							const color = entry.level === 'error' ? c.error : entry.level === 'warning' ? c.warn : c.dim;
							return (
								<box key={`lsp-diag-${index}`} onMouseUp={() => copy(`${entry.file}:${entry.line}:${entry.column}`)}>
									<text fg={c.dim}>{entry.file}:{entry.line}:{entry.column}</text>
									<text fg={color}> {entry.level}</text>
									<text fg={c.text}> {entry.message}</text>
								</box>
							);
						})}
						{!expanded && sortedDiagnostics.length > 8 ? (
							<box marginTop={1} onMouseDown={() => setExpanded(true)}>
								<text fg={c.dim}>… {sortedDiagnostics.length - 8} more · click to expand</text>
							</box>
						) : null}
					</>
				) : looksLikeDiff ? (
					<DiffContent text={props.output} filePath={file || undefined} />
				) : locationEntries.length > 0 ? (
					<>
						{groupLocations(locationEntries, expanded ? locationEntries.length : 12).map((group) => (
							<box key={group.file} flexDirection="column">
								<text fg={c.text}>{group.file}</text>
								{group.entries.map((entry, index) => (
									<box key={`lsp-loc-${group.file}-${index}`} paddingLeft={2} onMouseUp={() => copy(`${entry.file}:${entry.line}:${entry.column}`)}>
										<text fg={c.info}>{entry.line}:{entry.column}</text>
									</box>
								))}
							</box>
						))}
						{!expanded && locationEntries.length > 12 ? (
							<box marginTop={1} onMouseDown={() => setExpanded(true)}>
								<text fg={c.dim}>… {locationEntries.length - 12} more locations · click to expand</text>
							</box>
						) : null}
					</>
				) : (
					visible.map((line, index) => (
						<text key={`lsp-${index}`} fg={c.text} wrapMode="none">{line}</text>
					))
				)}
				{hidden > 0 && sortedDiagnostics.length === 0 && locationEntries.length === 0 ? (
					<box marginTop={1} onMouseDown={() => setExpanded(true)}>
						<text fg={c.dim}>… {hidden} more lines · click to expand</text>
					</box>
				) : expanded && lines.length > 12 && sortedDiagnostics.length === 0 && locationEntries.length === 0 ? (
					<box marginTop={1} onMouseDown={() => setExpanded(false)}>
						<text fg={c.dim}>click to collapse</text>
					</box>
				) : null}
			</box>

			{!pending && !props.isError ? (
				<box flexDirection="row" paddingLeft={1} gap={1}>
					{server ? <text fg={c.dim}>{server}</text> : null}
					{server && (summary || locationEntries.length > 0) ? <text fg={c.dim}>·</text> : null}
					{summary ? <text fg={c.dim}>{summary}</text> : null}
					{locationEntries.length > 0 ? <text fg={c.dim}>{locationEntries.length} locations · click to copy</text> : null}
					{looksLikeDiff ? <text fg={c.dim}>click to expand diff</text> : null}
				</box>
			) : null}
		</box>
	);
}

function groupLocations(
	entries: Array<{ file: string; line: number; column: number }>,
	limit: number,
): Array<{ file: string; entries: Array<{ file: string; line: number; column: number }> }> {
	const groups = new Map<string, Array<{ file: string; line: number; column: number }>>();
	for (const entry of entries.slice(0, limit)) {
		const list = groups.get(entry.file) ?? [];
		list.push(entry);
		groups.set(entry.file, list);
	}
	return [...groups.entries()].map(([file, list]) => ({ file, entries: list }));
}

/** Parse find_skills output into a structured list. */
function parseFindSkillsOutput(output: string): { query: string; matches: { name: string; desc: string }[] } {
	if (output.includes('No skills available') || output.includes('Provide a query')) {
		return { query: '', matches: [] };
	}
	const qm = output.match(/query="([^"]*)"/);
	const query = qm?.[1] ?? '';
	const lines = output.split('\n').filter((l) => l.startsWith('- '));
	const matches: { name: string; desc: string }[] = [];
	for (const line of lines) {
		const m = /^- ([^\s—]+)\s*—\s*(.+?)(?:\s*\(score:\s*[\d.]+\))?$/.exec(line.trim());
		if (m) matches.push({ name: m[1], desc: m[2].replace(/\s*\[.*?\]\s*$/, '').trim() });
	}
	return { query, matches };
}

function SkillToolView({ args, output, isError, marginTop }: { args: Record<string, unknown>; output: string; isError: boolean; marginTop: number }) {
	const name = String(args.name || '');
	const skillArgs = String(args.args || '');
	const borderColor = isError ? c.error : SKILL_COLOR;
	const statusIcon = isError ? '✗' : '✓';
	const preview = output
		.replace(/<\/?skill_content[^>]*>/g, '')
		.replace(/<\/?skill_files>/g, '')
		.replace(/<[^>]+>/g, '')
		.split('\n')
		.map((l) => l.trim())
		.find((l) => l.length > 0 && !l.startsWith('# Skill:') && !l.startsWith('Base directory')) ?? '';

	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={marginTop}
			gap={0}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={borderColor}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={borderColor}>◇</text>
				<text fg={borderColor} attributes={1}>Skill</text>
				<text fg={c.text}>{name}</text>
				{skillArgs ? <text fg={c.dim}>· {skillArgs}</text> : null}
				<text fg={isError ? c.error : SKILL_COLOR}> {statusIcon}</text>
			</box>
			{isError ? (
				<box flexDirection="column" paddingLeft={2} gap={0}>
					<text fg={c.error}>{output.slice(0, 120)}</text>
				</box>
			) : preview ? (
				<box flexDirection="column" paddingLeft={2} gap={0}>
					<text fg={c.dim}>{preview.slice(0, 100)}</text>
					<text fg={c.dim}>(instructions loaded)</text>
				</box>
			) : (
				<box flexDirection="column" paddingLeft={2} gap={0}>
					<text fg={c.dim}>(instructions loaded)</text>
				</box>
			)}
		</box>
	);
}

function FindSkillsToolView({ args, output, isError, marginTop }: { args: Record<string, unknown>; output: string; isError: boolean; marginTop: number }) {
	const { query, matches } = parseFindSkillsOutput(output);
	const borderColor = isError ? c.error : SKILL_COLOR;
	const statusIcon = isError ? '✗' : '✓';
	const noMatches = output.includes('No skills matched');
	const label = query ? `find "${query}"` : (args.all as boolean) ? 'catalog (all)' : 'catalog';

	return (
		<box
			flexDirection="column"
			paddingTop={1}
			paddingBottom={1}
			paddingLeft={2}
			marginTop={marginTop}
			gap={1}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={borderColor}
		>
			<box flexDirection="row" paddingLeft={1} gap={1}>
				<text fg={borderColor}>◇</text>
				<text fg={borderColor} attributes={1}>Skills</text>
				<text fg={c.dim}>· {label}</text>
				<text fg={isError ? c.error : SKILL_COLOR}> {statusIcon}</text>
			</box>
			<box flexDirection="column" paddingLeft={2} gap={0}>
				{noMatches ? (
					<text fg={c.dim}>No matching skills</text>
				) : matches.length > 0 ? (
					<>
						{matches.slice(0, 8).map((m, i) => (
							<box key={i} flexDirection="row" gap={1} overflow="hidden">
								<text fg={c.dim} flexShrink={0}>▸</text>
								<text fg={c.text} flexShrink={0}>{m.name}</text>
								<text fg={c.dim} overflow="hidden" wrapMode="none" truncate flexShrink={1}>{m.desc}</text>
							</box>
						))}
						{matches.length > 8 && (
							<text fg={c.dim}>… +{matches.length - 8} more</text>
						)}
					</>
				) : (
					<text fg={c.dim}>{output.slice(0, 120)}</text>
				)}
			</box>
			{matches.length > 0 && (
				<box flexDirection="row" paddingLeft={1} gap={1}>
					<text fg={c.dim}>{matches.length} match{matches.length !== 1 ? 'es' : ''} · load with skill {"<name>"}</text>
				</box>
			)}
		</box>
	);
}


const JOB_OP_LABELS: Record<string, string> = {
	status: 'Job status',
	probe: 'Job status',
	list: 'Background jobs',
	wait: 'Wait for jobs',
	transcript: 'Job transcript',
	send: 'Send to job',
	pause: 'Pause job',
	resume: 'Resume job',
	restart: 'Restart job',
	cancel: 'Cancel job',
};

function shortJobId(id: string): string {
	return id.length > 14 ? `…${id.slice(-8)}` : id;
}

function jobElapsed(job: Record<string, unknown>): string | null {
	const queuedAt = typeof job.queuedAt === 'number' ? job.queuedAt : undefined;
	const finishedAt = typeof job.finishedAt === 'number' ? job.finishedAt : undefined;
	if (queuedAt == null) return null;
	return `${(((finishedAt ?? Date.now()) - queuedAt) / 1000).toFixed(1)}s`;
}

function jobStateColor(state: string): string {
	if (state === 'running') return c.accent;
	if (state === 'completed') return c.success;
	if (state === 'failed') return c.error;
	if (state === 'paused') return c.warn;
	return c.dim;
}

function jobRow(job: Record<string, unknown>): { id: string; agent: string; state: string; elapsed: string | null; description: string } {
	return {
		id: typeof job.id === 'string' ? job.id : '',
		agent: typeof job.agent === 'string' ? job.agent : 'job',
		state: typeof job.state === 'string' ? job.state : 'unknown',
		elapsed: jobElapsed(job),
		description: typeof job.description === 'string' ? job.description : '',
	};
}

function JobToolView({ args, details, output, isError, streaming, marginTop }: {
	args: Record<string, unknown>;
	details?: Record<string, unknown>;
	output: string;
	isError: boolean;
	streaming: boolean;
	marginTop: number;
}) {
	const op = typeof args.op === 'string' ? args.op : 'status';
	const jobIcon = iconForJob();
	const job = details && isRecord(details.job) ? details.job : undefined;
	const listed = details && Array.isArray(details.jobs) ? details.jobs.filter(isRecord) : [];
	const row = job ? jobRow(job) : undefined;
	const argId = typeof args.id === 'string' ? args.id : '';
	const id = row?.id || argId;
	const header = JOB_OP_LABELS[op] ?? `Job ${op}`;
	const borderColor = isError ? c.error : c.tool;
	const lines = output ? output.split('\n').filter((line) => line.trim().length > 0) : [];
	const activity = job && typeof job.activity === 'string'
		? job.activity
		: lines.find((line) => line.startsWith('activity: '))?.slice('activity: '.length);
	const generation = job && typeof job.generation === 'number' ? job.generation : 0;
	const retries = job && typeof job.retryAttempts === 'number' ? job.retryAttempts : 0;
	const result = job && typeof job.result === 'string' ? job.result : '';
	const error = job && typeof job.error === 'string' ? job.error : '';

	return (
		<box
			flexDirection="column"
			paddingLeft={2}
			marginTop={marginTop}
			gap={0}
			backgroundColor={c.bgTool}
			border={['left']}
			customBorderChars={SB}
			borderColor={borderColor}
		>
			<box flexDirection="row" paddingLeft={1} gap={1} overflow="hidden">
				<text fg={jobIcon.color} flexShrink={0}>{jobIcon.glyph}</text>
				<text fg={borderColor} attributes={1} flexShrink={0}>{header}</text>
				{row?.description ? <text fg={c.dim} wrapMode="none" truncate flexShrink={1}>· {row.description}</text> : id ? <text fg={c.dim} flexShrink={0}>· {shortJobId(id)}</text> : null}
				<text fg={isError ? c.error : c.success} flexShrink={0}>{isError ? '✗' : '✓'}</text>
			</box>
			<box flexDirection="column" paddingLeft={1} gap={0}>
				{row ? (
					<>
						<box flexDirection="row" gap={1}>
							<text fg={c.dim}>{shortJobId(row.id)}</text>
							<text fg={c.dim}>·</text>
							<text fg={c.text}>{row.agent}</text>
							<text fg={c.dim}>·</text>
							<text fg={jobStateColor(row.state)}>{row.state}</text>
							{row.elapsed ? <><text fg={c.dim}>·</text><text fg={c.subtext}>{row.elapsed}</text></> : null}
							{op === 'status' || op === 'probe' ? <><text fg={c.dim}>·</text><text fg={c.dim}>gen {generation} · retries {retries}</text></> : null}
						</box>
						{activity ? <text fg={c.subtext}>↳ {activity}</text> : null}
						{error ? <text fg={c.error}>{error}</text> : null}
						{result ? <TruncatedContent text={result} maxLines={4} /> : null}
					</>
				) : listed.length > 0 ? (
					listed.slice(0, 8).map((entry, index) => {
						const item = jobRow(entry);
						return (
							<box key={`${item.id}-${index}`} flexDirection="row" gap={1} overflow="hidden">
								<text fg={jobStateColor(item.state)} flexShrink={0}>{item.state}</text>
								<text fg={c.subtext} flexShrink={0}>{item.agent}</text>
								<text fg={c.dim} flexShrink={0}>{shortJobId(item.id)}</text>
								{item.elapsed ? <text fg={c.dim} flexShrink={0}>{item.elapsed}</text> : null}
								<text fg={c.text} wrapMode="none" truncate flexShrink={1}>{item.description}</text>
							</box>
						);
					})
				) : lines.length > 0 ? (
					<TruncatedContent
						text={lines.slice(0, 6).join('\n').split(id).join(shortJobId(id))}
						maxLines={4}
						color={isError ? c.error : undefined}
					/>
				) : (
					<text fg={c.dim}>{streaming ? 'Working...' : 'No output'}</text>
				)}
			</box>
		</box>
	);
}

export function renderMessageView({
	msg,
	showThinking = true,
	isFirst = false,
	isRevertPoint = false,
	onMessageClick,
	onTaskClick,
}: {
	msg: ChatMessage;
	showThinking?: boolean;
	isFirst?: boolean;
	isRevertPoint?: boolean;
	onMessageClick?: (msg: ChatMessage) => void;
	onTaskClick?: (childSessionId: string) => void;
}) {
	const mt = isFirst ? 0 : 1;

	if (msg.role === 'user' && msg.hiddenSystem) {
		const [header, ...rest] = msg.content.split('\n');
		return (
			<box
				flexDirection="column"
				marginTop={mt}
				backgroundColor={c.bgTool}
				border={['left']}
				customBorderChars={SB}
				borderColor={c.info}
				paddingLeft={2}
				paddingRight={1}
			>
				<box flexDirection="row" gap={1}>
					<text fg={c.info}>{'⌁'} LSP</text>
					<text fg={c.dim}>late diagnostics</text>
					<text fg={c.dim}>· {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</text>
				</box>
				<text fg={c.dim}>{header.replace(/^LSP diagnostics for /, '')}</text>
				{rest.length > 0 && <TruncatedContent text={rest.join('\n')} maxLines={4} />}
			</box>
		);
	}

	if (msg.role === 'user') {
		return (
			<box
				flexDirection="column"
				marginTop={mt}
				backgroundColor={c.bg}
				border={['left']}
				customBorderChars={SB}
				borderColor={isRevertPoint ? c.warn : c.user}
				paddingLeft={2}
				paddingRight={1}
				onMouseUp={onMessageClick ? () => onMessageClick(msg) : undefined}
			>
				<text fg={c.user} attributes={1} height={1}>
					You
				</text>
				<text fg={c.text} attributes={1} maxHeight={10}>
					{msg.content}
				</text>
				{msg.attachments && msg.attachments.length > 0 && (
					<box flexDirection="row" flexWrap="wrap" gap={1} marginTop={0}>
						{msg.attachments.map((att: PromptAttachment, i: number) => {
							const metadata = formatAttachmentMetadata(att);
							return (
								<box key={`${att.filename}-${i}`} flexDirection="row" gap={0}>
									<text fg={att.badge.color} attributes={1}>{formatAttachmentBadge(att, { includeFilename: false })}</text>
									<text fg={c.dim}> {att.filename}{metadata ? ` · ${metadata}` : ''}</text>
								</box>
							);
						})}
					</box>
				)}
				{isRevertPoint && (
					<box flexDirection="row" marginTop={1} gap={1}>
						<text fg={c.warn} height={1}>
							⎌
						</text>
						<text fg={c.dim} height={1}>
							Messages after this point were reverted
						</text>
					</box>
				)}
			</box>
		);
	}

	if (msg.role === 'assistant') {
		// Build turn footer: agent · model · duration · status
		const agentName = msg.agent || 'build';
		const showFooter = !msg.streaming && (msg.turnStatus || msg.turnTokens);
		const isInterrupted = msg.turnStatus === 'interrupted';
		const isError = msg.turnStatus === 'error';
		const durationStr =
			msg.turnDurationMs && msg.turnDurationMs > 1000
				? `${(msg.turnDurationMs / 1000).toFixed(1)}s`
				: msg.turnDurationMs
					? `${msg.turnDurationMs}ms`
					: null;
		const tokensStr = msg.turnTokens ? `↑${msg.turnTokens.input} ↓${msg.turnTokens.output}` : null;

		return (
			<box flexDirection="column" marginTop={mt}>
				{msg.blocks && msg.blocks.length === 0 && msg.streaming ? (
					<text fg={c.dim} paddingLeft={2}>
						(streaming...)
					</text>
				) : null}
				{msg.blocks ? (
					<box flexDirection="column" paddingLeft={3}>
						{(() => {
							const thinkBlocks = msg.blocks.filter(
								(b): b is { type: 'thinking'; content: string } => b.type === 'thinking',
							);
							const textBlocks = msg.blocks.filter(
								(b): b is { type: 'text'; content: string } => b.type === 'text',
							);
							const mdContent = textBlocks.map((b) => b.content).join('\n');
							const hasThinking = showThinking && thinkBlocks.length > 0;
							return (
								<>
									{hasThinking &&
										thinkBlocks.map((block, i) => (
											<code
												key={`think-${i}`}
												filetype="markdown"
												drawUnstyledText={false}
												streaming={!!msg.streaming}
												syntaxStyle={mdStyleMuted}
												content={prepareMarkdown(block.content)}
												conceal={true}
												fg={c.dim}
												marginTop={i === 0 ? 0 : 1}
											/>
										))}
									{mdContent ? (
										<markdown
											content={prepareMarkdown(mdContent)}
											syntaxStyle={mdStyle}
											streaming={!!msg.streaming}
											internalBlockMode="top-level"
											conceal={true}
											width="100%"
											fg={c.text}
											bg={c.bg}
											tableOptions={{ style: 'grid', borders: true, borderStyle: 'single' }}
											marginTop={hasThinking ? 1 : 0}
										/>
									) : null}
								</>
							);
						})()}
					</box>
				) : (
					<text fg={isInterrupted ? c.dim : c.text} paddingLeft={3}>
						{msg.content}
					</text>
				)}
			{showFooter && (
				<box flexDirection="column" paddingLeft={3} marginTop={1}>
					<box flexDirection="row" gap={1}>
						<text fg={c.accent}>▣</text>
						<text fg={c.text}>{agentName}</text>
						{msg.model && <text fg={c.dim}>· {msg.model}</text>}
						{durationStr && <text fg={c.dim}>· {durationStr}</text>}
						{tokensStr && <text fg={c.dim}>· {tokensStr}</text>}
						{!isInterrupted && !isError && msg.turnStatus === 'completed' && (
							<text fg={c.success}>· done</text>
						)}
					</box>
				</box>
			)}
			</box>
		);
	}

	if (msg.role === 'tool') {
		const raw = msg.meta || '';
		const tName = msg.toolName || (raw.includes('(') ? raw.split('(')[0] : raw);
		const rawArgs = raw.includes('(') ? raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')) : '';

		let argsObj: Record<string, unknown> = msg.toolArguments || {};
		let argsStr = rawArgs;
		if (!msg.toolArguments) {
			try {
				const parsed = JSON.parse(rawArgs);
				if (typeof parsed === 'object' && parsed !== null) argsObj = parsed;
			} catch {
				if (argsStr === 'undefined') argsStr = '';
			}
		}
		if (Object.keys(argsObj).length > 0) {
			argsStr = Object.values(argsObj)
				.filter((value) => value !== undefined && value !== 'undefined')
				.map(String)
				.join(' ');
		}

		const output = stripAnsi(msg.content || '');
		const isReadingTool = ['read', 'glob', 'grep'].includes(tName);
		const toolError = msg.toolError === true;

		if (toolError && formatValidationError(output)) {
			return <ValidationErrorTool toolName={tName || 'tool'} output={output} marginTop={mt} />;
		}

		if (tName === 'todo' && msg.todoState) {
			return <TodoToolView state={msg.todoState} marginTop={mt} />;
		}
		if (tName === 'ask' && normalizeAskResults(msg.toolDetails).length > 0) {
			return <AskToolView details={msg.toolDetails!} marginTop={mt} />;
		}
		if (tName === 'memory') {
			return <MemoryToolView args={argsObj} output={output} isError={toolError} marginTop={mt} />;
		}
		if (tName === 'skill') {
			return <SkillToolView args={argsObj} output={output} isError={toolError} marginTop={mt} />;
		}
		if (tName === 'find_skills') {
			return <FindSkillsToolView args={argsObj} output={output} isError={toolError} marginTop={mt} />;
		}

		// Reading tools: inline indicator only
		if (isReadingTool) {
			const readColor = toolError ? c.error : c.readTool;
			const icon = tName === 'read' ? '→' : tName === 'glob' ? '◎' : '⊕';
			if (tName === 'read') {
				const filePath = String(argsObj.path || argsObj.file_path || argsStr.split(' ')[0] || '');
				const offset = argsObj.offset as number | undefined;
				const limit = argsObj.limit as number | undefined;
				let range: string | undefined;
				if (offset && limit) range = `${filePath}:${offset}-${offset + limit - 1} (${limit} lines)`;
				else if (offset) range = `${filePath}:${offset}`;
				else if (limit) range = `${filePath} (${limit} lines)`;
				return (
					<InlineTool
						icon={icon}
						title={`Read ${filePath}`}
						titleContent={<ToolTitleRow icon={icon} toolName={'Read'} toolColor={readColor} fileName={filePath} />}
						color={c.text}
						titleColor={readColor}
						marginTop={mt}
						status={toolError ? 'error' : 'success'}
						meta={range ? `${offset || 1}-${offset ? (offset + (limit || 1) - 1) : (limit || '?')}` : undefined}
					/>
				);
			}
			if (tName === 'glob') {
				const pattern = argsObj.pattern || argsStr.split(' ')[0] || '';
				const dir = argsObj.path || argsObj.dir || '';
				return (
					<InlineTool
						icon={icon}
						title={`Glob`}
						color={c.text}
						titleColor={readColor}
						marginTop={mt}
						status={toolError ? 'error' : 'success'}
						meta={pattern + (dir ? ` in ${dir}` : '')}
					/>
				);
			}
			if (tName === 'grep') {
				const pattern = argsObj.pattern || argsStr.split(' ')[0] || '';
				const dir = argsObj.path || argsObj.dir || '';
				return (
					<InlineTool
						icon={icon}
						title={`Grep`}
						color={c.text}
						titleColor={readColor}
						marginTop={mt}
						status={toolError ? 'error' : 'success'}
						meta={pattern + (dir ? ` in ${dir}` : '')}
					/>
				);
			}
			const displayTitle = argsStr ? `${tName} ${argsStr}` : tName;
			return (
				<InlineTool
					icon={icon}
					title={displayTitle}
					color={readColor}
					titleColor={readColor}
					marginTop={mt}
					status={toolError ? 'error' : 'success'}
				/>
			);
		}

		if (tName === 'task') {
			const subagentType = (argsObj as any)?.agent || (argsObj as any)?.subagent_type || 'subagent';
			const description = (argsObj as any)?.description || '';
			const title = `@${subagentType} ${description}`.slice(0, 60);
			const statusColor = toolError ? c.error : c.success;
			const borderColor = toolError ? c.error : c.thinking;
			const childSessionId = msg.childSessionId;
			const isBackground = msg.background === true;
			const clickable = !!(childSessionId && onTaskClick);
			const isRunningInBackground = isBackground && !output;

			if (!output) {
				return (
					<box
						flexDirection="column"
						paddingTop={1}
						paddingBottom={1}
						paddingLeft={2}
						marginTop={mt}
						gap={1}
						backgroundColor={c.bgTool}
						border={['left']}
						customBorderChars={SB}
						borderColor={borderColor}
						{...(clickable ? { onMouseUp: () => onTaskClick!(childSessionId!) } : {})}
					>
						<box flexDirection="row" gap={1} paddingLeft={1}>
							<text fg={borderColor} flexShrink={0}>{toolError ? '!' : '◆'}</text>
							<text fg={c.dim} wrapMode="none" truncate flexShrink={1}>{title}</text>
							{isRunningInBackground ? (
								<text fg={c.accent}>(running in background...)</text>
							) : (
								<text fg={c.accent}>(running...)</text>
							)}
						</box>
						{clickable && (
							<box paddingLeft={2}>
								<text fg={c.dim}>{isBackground ? 'click to open · bg' : 'click to open'}</text>
							</box>
						)}
					</box>
				);
			}

			return (
				<box
					flexDirection="column"
					paddingTop={1}
					paddingBottom={1}
					paddingLeft={2}
					marginTop={mt}
					gap={1}
					backgroundColor={c.bgTool}
					border={['left']}
					customBorderChars={SB}
					borderColor={borderColor}
					{...(clickable ? { onMouseUp: () => onTaskClick!(childSessionId!) } : {})}
				>
					<box flexDirection="row" gap={1} paddingLeft={1}>
						<text fg={borderColor} flexShrink={0}>{toolError ? '!' : '◆'}</text>
						<text fg={c.dim} wrapMode="none" truncate flexShrink={1}>{title}</text>
						<text fg={statusColor} flexShrink={0} wrapMode="none">{toolError ? '(failed)' : '(done)'}</text>
						{clickable && <text fg={c.accent}>· click to open</text>}
					</box>
					<box paddingLeft={2}>
						<markdown
							content={prepareMarkdown(output)}
							syntaxStyle={mdStyle}
							conceal={true}
							width="100%"
							tableOptions={{ style: 'grid', borders: true, borderStyle: 'single' }}
						/>
					</box>
				</box>
			);
		}

		if (tName === 'bash' || tName === 'shell') {
			const command = (argsObj as any)?.command || argsStr;
			const description = (argsObj as any)?.description;
			const exitCode = msg.exitCode ?? null;
			const exitColor = exitCode === 0 && !toolError ? c.success : c.error;
			const shellColor = toolError ? c.error : c.execTool;
			const wallTimeMs = msg.wallTimeMs;
			const timeoutMs = msg.timeoutMs;
			const wallStr = wallTimeMs != null ? (wallTimeMs >= 1000 ? `${(wallTimeMs / 1000).toFixed(2)}s` : `${wallTimeMs}ms`) : null;
			const timeoutStr = timeoutMs != null ? `${Math.round(timeoutMs / 1000)}s` : null;

			return (
				<box
					flexDirection="column"
					paddingTop={1}
					paddingBottom={1}
					paddingLeft={2}
					marginTop={mt}
					gap={1}
					backgroundColor={c.bgTool}
					border={['left']}
					customBorderChars={SB}
					borderColor={shellColor}
				>
					<box flexDirection="row" justifyContent="space-between" alignItems="flex-start" paddingLeft={1} gap={1} overflow="hidden">
						<box flexDirection="column" gap={1} flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
							{description ? (
								<text fg={c.subtext} attributes={2} wrapMode="none" truncate>
									{description}
								</text>
							) : null}
							<box flexDirection="row" gap={0} flexShrink={1} overflow="hidden">
								<text fg={shellColor} flexShrink={0}>$ </text>
								<code content={command} syntaxStyle={mdStyle} filetype="bash" streaming={!msg.toolArgumentsComplete} conceal={true} drawUnstyledText={false} flexShrink={1} />
							</box>
						</box>
						{exitCode !== null && <text fg={exitColor} flexShrink={0} wrapMode="none">{exitCode === 0 && !toolError ? '✓' : '✗'} Exit {exitCode}</text>}
						{exitCode === null && toolError && <text fg={c.error} flexShrink={0} wrapMode="none">✗ Failed</text>}
					</box>
					<box paddingLeft={2}>
						{output ? (
							<TruncatedContent text={output} maxLines={MAX_SHELL_LINES} color={toolError ? c.error : undefined} />
						) : (
							<text fg={toolError ? c.error : c.dim}>
								{toolError ? 'Command failed with no output' : msg.streaming ? 'Running...' : 'No output'}
							</text>
						)}
					</box>
					{(wallStr || timeoutStr) && (
						<box flexDirection="row" gap={1} paddingLeft={1}>
							<text fg={c.dim}>[</text>
							{wallStr && <text fg={c.subtext}>Wall: {wallStr}</text>}
							{wallStr && timeoutStr && <text fg={c.dim}> | </text>}
							{timeoutStr && <text fg={c.subtext}>Timeout: {timeoutStr}</text>}
							<text fg={c.dim}>]</text>
						</box>
					)}
				</box>
			);
		}

		if (tName === 'write') {
			const path = typeof argsObj.path === 'string' ? argsObj.path : '';
			const liveContent = typeof argsObj.content === 'string' ? argsObj.content : '';
			const fileName = path ? basename(path) : '';
			const dirPath = path && path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
			const writeColor = toolError ? c.error : c.writeTool;
			const ft = path ? filetype(path) : undefined;
			return (
				<box
					flexDirection="column"
					paddingY={1}
					paddingLeft={2}
					marginTop={mt}
					gap={1}
					backgroundColor={c.bgTool}
					border={['left']}
					customBorderChars={SB}
					borderColor={writeColor}
				>
					<box flexDirection="row" gap={0} overflow="hidden">
						<text fg={writeColor} flexShrink={0}>{toolError ? 'Write failed' : 'Write'}</text>
						{fileName ? <text fg={c.text} wrapMode="none" truncate flexShrink={1}> {getFileIcon(fileName)} {fileName}</text> : <text fg={c.dim} flexShrink={0}> ...</text>}
						<text fg={writeColor} flexShrink={0}>{toolError ? ' ✗' : msg.streaming ? ' …' : ' ✓'}</text>
					</box>
					<box flexDirection="column" paddingLeft={1}>
						{dirPath ? <text fg={c.dim}>{dirPath}</text> : null}
						{msg.streaming ? (
							liveContent ? (
								<code
									content={liveContent}
									syntaxStyle={mdStyle}
									{...(ft ? { filetype: ft } : {})}
									streaming={!msg.toolArgumentsComplete}
									conceal={true}
									drawUnstyledText={false}
									maxHeight={12}
								/>
							) : <text fg={c.dim}>Receiving file content...</text>
						) : toolError && output ? (
							<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} color={c.error} />
						) : output ? (
							<DiffContent text={output} filePath={path} />
						) : (
							<text fg={toolError ? c.error : c.dim}>{toolError ? 'Write failed with no output' : 'File written'}</text>
						)}
					</box>
				</box>
			);
		}

		if (tName === 'edit') {
			const path = typeof argsObj.path === 'string' ? argsObj.path : '';
			const oldString = typeof argsObj.oldString === 'string' ? argsObj.oldString : '';
			const newString = typeof argsObj.newString === 'string' ? argsObj.newString : '';
			const fileName = path ? basename(path) : '';
			const dirPath = path && path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
			const editColor = toolError ? c.error : c.editTool;
			const ft = path ? filetype(path) : undefined;
			return (
				<box
					flexDirection="column"
					paddingLeft={2}
					paddingY={1}
					marginTop={mt}
					gap={1}
					backgroundColor={c.bgTool}
					border={['left']}
					customBorderChars={SB}
					borderColor={editColor}
				>
					<box flexDirection="row" gap={0} overflow="hidden">
						<text height={1} fg={editColor} flexShrink={0}>{toolError ? 'Edit failed' : 'Edit'}</text>
						{fileName ? <text fg={c.text} wrapMode="none" truncate flexShrink={1}> {getFileIcon(fileName)} {fileName}</text> : <text fg={c.dim} flexShrink={0}> ...</text>}
						{dirPath ? <text fg={c.dim} wrapMode="none" truncate flexShrink={1}> {dirPath}</text> : null}
						<text fg={editColor} flexShrink={0}>{toolError ? ' ✗' : msg.streaming ? ' …' : ' ✓'}</text>
					</box>
					{msg.streaming ? (
						<box flexDirection="column" paddingLeft={1} gap={1}>
							{oldString ? (
								<box flexDirection="column">
									<text fg={c.dim}>Match</text>
									<code content={oldString} syntaxStyle={mdStyle} {...(ft ? { filetype: ft } : {})} streaming={!msg.toolArgumentsComplete} conceal={true} drawUnstyledText={false} maxHeight={8} />
								</box>
							) : null}
							{newString ? (
								<box flexDirection="column">
									<text fg={c.dim}>Replacement</text>
									<code content={newString} syntaxStyle={mdStyle} {...(ft ? { filetype: ft } : {})} streaming={!msg.toolArgumentsComplete} conceal={true} drawUnstyledText={false} maxHeight={8} />
								</box>
							) : null}
							{!oldString && !newString ? <text fg={c.dim}>Receiving edit...</text> : null}
						</box>
					) : toolError && output ? (
						<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} color={c.error} />
					) : output ? (
						<DiffContent text={output} filePath={path} />
					) : (
						<text fg={toolError ? c.error : c.dim} paddingLeft={1}>{toolError ? 'Edit failed with no output' : 'Edit applied'}</text>
					)}
				</box>
			);
		}

		if (tName === 'job') {
			return (
				<JobToolView
					args={argsObj}
					details={msg.toolDetails}
					output={output}
					isError={toolError}
					streaming={msg.streaming === true}
					marginTop={mt}
				/>
			);
		}

		if (tName === 'lsp') {
			return (
				<LspToolView
					args={argsObj}
					details={msg.toolDetails}
					output={output}
					isError={toolError}
					streaming={msg.streaming === true}
					marginTop={mt}
				/>
			);
		}

		if (tName === 'web_search') {
			return (
				<WebSearchToolView
					args={argsObj}
					details={msg.toolDetails}
					output={output}
					isError={toolError}
					streaming={msg.streaming === true}
					marginTop={mt}
				/>
			);
		}

		if (tName === 'web_fetch') {
			const url = argsObj.url || argsStr;
			const displayTitle = toolError ? (url ? `Fetch failed: ${url}` : 'Fetch failed') : url ? `Fetch ${url}` : 'Fetch';
			const fetchColor = toolError ? c.error : c.info;
			if (!output) return <InlineTool icon={toolError ? '!' : '↗'} title={displayTitle} color={fetchColor} titleColor={fetchColor} marginTop={mt} status={toolError ? 'error' : msg.streaming ? undefined : 'success'} />;
			return (
				<BlockTool title={displayTitle} titleColor={fetchColor} borderColor={fetchColor} marginTop={mt} status={toolError ? 'error' : 'success'}>
					<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} color={toolError ? c.error : undefined} />
				</BlockTool>
			);
		}

		const genericColor = toolError ? c.error : c.tool;
		if (!output) return (
			<InlineTool
				icon={toolError ? '!' : '⚙'}
				title={toolError ? `${raw} failed` : raw}
				titleContent={
					<box flexDirection="row" gap={0}>
						<text fg={genericColor} flexShrink={0}>⚙ {tName}</text>
						{argsStr ? <text fg={c.text} wrapMode="none" truncate flexShrink={1}> {argsStr}</text> : null}
						{toolError ? <text fg={c.error} flexShrink={0}> failed</text> : null}
					</box>
				}
				color={genericColor}
				marginTop={mt}
				status={toolError ? 'error' : 'success'}
			/>
		);
		const displayTitle = toolError ? `${argsStr ? `${tName} ${argsStr}` : tName} failed` : argsStr ? `${tName} ${argsStr}` : tName;
		return (
			<BlockTool
				title={displayTitle}
				titleContent={
					<box flexDirection="row" gap={0}>
						<text fg={genericColor} flexShrink={0}>⚙ {tName}</text>
						{argsStr ? <text fg={c.text} wrapMode="none" truncate flexShrink={1}> {argsStr}</text> : null}
						{toolError ? <text fg={c.error} flexShrink={0}> failed</text> : null}
					</box>
				}
				titleColor={genericColor}
				borderColor={genericColor}
				marginTop={mt}
				status={toolError ? 'error' : 'success'}
			>
				<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} color={toolError ? c.error : undefined} />
				{msg.images?.map((image, index) => (
					<box key={`tool-image-${index}`} marginTop={1} width={48} height={16}>
						<image
							source={Buffer.from(image.data, 'base64')}
							width={48}
							height={16}
							fit="fit"
						/>
					</box>
				))}
			</BlockTool>
		);
	}

	return (
		<box paddingLeft={2} border={['left']} customBorderChars={SB} borderColor={c.error} marginTop={mt}>
			<text fg={c.error}>
				<strong>Error:</strong> {msg.content}
			</text>
		</box>
	);
}


/** Memoized so streaming deltas only re-render the message that changed. */
export const MessageView = memo(renderMessageView);
