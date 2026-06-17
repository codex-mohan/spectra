import { useState } from 'react';
import { c, mdStyle, mdStyleMuted } from '../theme.js';
import type { ChatMessage, ContentBlock } from '../types.js';
import stripAnsi from 'strip-ansi';
import { basename } from 'path';
import { parsePatch } from 'diff';

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

const MAX_SHELL_LINES = 10;
const MAX_GENERIC_LINES = 3;
const MAX_DIFF_LINES = 6;

function DiffContent(props: { text: string; maxLines: number }) {
	const [expanded, setExpanded] = useState(false);
	
	// Parse the unified diff to get line numbers
	const diffRows: { content: string; type: 'add' | 'remove' | 'context'; oldLine?: number; newLine?: number }[] = [];
	let additions = 0;
	let deletions = 0;
	
	try {
		const patches = parsePatch(props.text);
		for (const patch of patches) {
			for (const hunk of patch.hunks) {
				let oldLine = hunk.oldStart;
				let newLine = hunk.newStart;
				
				for (const line of hunk.lines) {
					const content = line.slice(1);
					const prefix = line[0];
					
					if (prefix === ' ') {
						diffRows.push({ content, type: 'context', oldLine, newLine });
						oldLine++;
						newLine++;
					} else if (prefix === '-') {
						deletions++;
						diffRows.push({ content, type: 'remove', oldLine, newLine });
						oldLine++;
					} else if (prefix === '+') {
						additions++;
						diffRows.push({ content, type: 'add', oldLine, newLine });
						newLine++;
					}
					// Skip '\\' (no newline marker) and '+++'/'---' headers
				}
			}
		}
	} catch {
		// Fallback: just show raw lines
		const lines = props.text.split('\n');
		for (const line of lines) {
			if (line.startsWith('+')) {
				additions++;
				diffRows.push({ content: line.slice(1), type: 'add' });
			} else if (line.startsWith('-')) {
				deletions++;
				diffRows.push({ content: line.slice(1), type: 'remove' });
			} else if (line && !line.startsWith('@@') && !line.startsWith('===') && !line.startsWith('---') && !line.startsWith('+++')) {
				diffRows.push({ content: line.startsWith(' ') ? line.slice(1) : line, type: 'context' });
			}
		}
	}

	const overflow = diffRows.length > props.maxLines;
	const display = expanded || !overflow ? diffRows : diffRows.slice(0, props.maxLines);

	return (
		<box flexDirection="column" gap={0}>
			<box flexDirection="row" gap={1}>
				{deletions > 0 && <text fg={c.error}>-{deletions}</text>}
				{additions > 0 && <text fg={c.success}>+{additions}</text>}
			</box>
			<box flexDirection="column" gap={0} onMouseDown={overflow ? () => setExpanded(!expanded) : undefined}>
				{display.map((row, i) => {
					let fg = c.text;
					let bg = undefined;
					if (row.type === 'add') fg = c.success;
					else if (row.type === 'remove') fg = c.error;
					
					return (
						<box key={i} flexDirection="row" gap={1}
							backgroundColor={row.type === 'remove' ? c.diffRemoveBg : row.type === 'add' ? c.diffAddBg : undefined}
						>
							<text fg={c.dim} width={5}>
								{row.type === 'remove'
									? (row.oldLine !== undefined ? String(row.oldLine).padStart(4, ' ') : '    ')
									: (row.newLine !== undefined ? String(row.newLine).padStart(4, ' ') : '    ')
								}
							</text>
							<text fg={fg} width={2}>
								{row.type === 'remove' ? '-' : row.type === 'add' ? '+' : ' '}
							</text>
							<text fg={fg}>{row.content}</text>
						</box>
					);
				})}
				{overflow && !expanded && <text fg={c.dim} height={1} marginTop={1}>
					click to expand
				</text>}
				{overflow && expanded && <text fg={c.dim} height={1} marginTop={1}>
					click to collapse
				</text>}
			</box>
		</box>
	);
}

function InlineTool(props: { icon: string; title: string; meta?: string; color?: string; marginTop?: number }) {
	return (
		<box flexDirection="row" paddingLeft={3} marginTop={props.marginTop ?? 0}>
			<text fg={props.color || c.tool}>{props.icon} </text>
			<text fg={c.dim}>{props.title}</text>
			{props.meta ? <text fg={c.dim}> {props.meta}</text> : null}
		</box>
	);
}

function BlockTool(props: { title: string; titleColor?: string; borderColor?: string; children: any; marginTop?: number }) {
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
			<text fg={props.titleColor || c.tool} paddingLeft={1}>
				{props.title}
			</text>
			<box paddingLeft={2}>{props.children}</box>
		</box>
	);
}

function TruncatedContent(props: { text: string; maxLines: number }) {
	const [expanded, setExpanded] = useState(false);
	const lines = props.text.split('\n');
	const overflow = lines.length > props.maxLines;
	const display = expanded || !overflow ? props.text : lines.slice(0, props.maxLines).join('\n') + '\n…';
	return (
		<box flexDirection="column" onMouseDown={overflow ? () => setExpanded(!expanded) : undefined}>
			<text fg={c.text}>{display}</text>
			{overflow ? <text fg={c.dim}>{expanded ? 'click to collapse' : 'click to expand'}</text> : null}
		</box>
	);
}

export function MessageView({
	msg,
	showThinking = true,
	isFirst = false,
	isRevertPoint = false,
	onClick,
}: {
	msg: ChatMessage;
	showThinking?: boolean;
	isFirst?: boolean;
	isRevertPoint?: boolean;
	onClick?: () => void;
}) {
	const mt = isFirst ? 0 : 1;

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
				onMouseUp={onClick}
			>
				<text fg={c.user} attributes={1} height={1}>
					You
				</text>
				<text fg={c.text} attributes={1} maxHeight={10}>
					{msg.content}
				</text>
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
											<markdown
												key={`think-${i}`}
												content={block.content}
												syntaxStyle={mdStyleMuted}
												streaming={!!msg.streaming}
												conceal={true}
												width="100%"
												tableOptions={{ style: 'grid', borders: true, borderStyle: 'single' }}
												marginTop={i === 0 ? 0 : 1}
											/>
										))}
									{mdContent ? (
										<markdown
											content={mdContent}
											syntaxStyle={mdStyle}
											streaming={!!msg.streaming}
											conceal={true}
											width="100%"
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
		const tName = raw.includes('(') ? raw.split('(')[0] : raw;
		const rawArgs = raw.includes('(') ? raw.slice(raw.indexOf('(') + 1, raw.lastIndexOf(')')) : '';

		// Parse args: try JSON first, fall back to raw string
		let argsObj: Record<string, unknown> = {};
		let argsStr = rawArgs;
		try {
			const parsed = JSON.parse(rawArgs);
			if (typeof parsed === 'object' && parsed !== null) {
				argsObj = parsed;
				argsStr = Object.values(parsed)
					.filter((v) => v !== undefined && v !== 'undefined')
					.map((v) => String(v))
					.join(' ');
			}
		} catch {
			if (argsStr === 'undefined') argsStr = '';
		}

		const output = stripAnsi(msg.content || '');
		const isReadingTool = ['read', 'glob', 'grep'].includes(tName);

		// Reading tools: only show inline indicator, never show output
		if (isReadingTool) {
			const displayTitle = (() => {
				if (tName === 'read') {
					const filePath = argsObj.path || argsObj.file_path || argsStr.split(' ')[0] || '';
					const limit = argsObj.limit as number | undefined;
					const suffix = limit ? ` (${limit} lines)` : '';
					return `Read ${filePath}${suffix}`;
				}
				if (tName === 'glob') {
					const pattern = argsObj.pattern || argsStr.split(' ')[0] || '';
					const dir = argsObj.path || argsObj.dir || '';
					return `Glob ${pattern}${dir ? ` in ${dir}` : ''}`;
				}
				if (tName === 'grep') {
					const pattern = argsObj.pattern || argsStr.split(' ')[0] || '';
					const dir = argsObj.path || argsObj.dir || '';
					return `Grep ${pattern}${dir ? ` in ${dir}` : ''}`;
				}
				return argsStr ? `${tName} ${argsStr}` : tName;
			})();
			const icon = tName === 'read' ? '→' : tName === 'glob' ? '◎' : '⊕';
			return (
				<InlineTool
					icon={icon}
					title={displayTitle}
					color={c.readTool}
					marginTop={mt}
				/>
			);
		}

		if (tName === 'task') {
			const subagentType = (argsObj as any)?.subagent_type || 'subagent';
			const description = (argsObj as any)?.description || '';
			const title = `@${subagentType} ${description}`.slice(0, 60);

			if (!output) {
				return (
					<box flexDirection="row" paddingLeft={2} marginTop={mt} gap={1}>
						<text fg={c.thinking}>◆</text>
						<text fg={c.dim}>{title}</text>
						<text fg={c.accent}>(running...)</text>
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
					borderColor={c.thinking}
				>
					<box flexDirection="row" gap={1} paddingLeft={1}>
						<text fg={c.thinking}>◆</text>
						<text fg={c.dim}>{title}</text>
						<text fg={c.success}>(done)</text>
					</box>
					<box paddingLeft={2}>
						<markdown
							content={output}
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
			const exitColor = exitCode === 0 ? c.success : c.error;

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
					borderColor={c.execTool}
				>
					<box flexDirection="row" justifyContent="space-between" alignItems="flex-start" paddingLeft={1}>
						<box flexDirection="column" gap={1}>
							{description ? (
								<text fg={c.subtext} attributes={2}>
									{description}
								</text>
							) : null}
							<text fg={c.execTool}>$ {command}</text>
						</box>
						{exitCode !== null && <text fg={exitColor}>{exitCode === 0 ? '✓' : '✗'} Exit {exitCode}</text>}
					</box>
					<box paddingLeft={2}>
						{output ? (
							<TruncatedContent text={output} maxLines={MAX_SHELL_LINES} />
						) : (
							<text fg={c.dim}>No output</text>
						)}
					</box>
				</box>
			);
		}

		if (tName === 'write') {
			const path = (argsObj as any)?.path || argsStr;
			const fileName = path ? basename(path) : '';
			const dirPath = path && path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
			const displayTitle = fileName ? `Wrote ${fileName}` : 'Wrote';
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
					borderColor={c.writeTool}
				>
					<text fg={c.writeTool}>
						{displayTitle}
					</text>
					<box paddingLeft={2}>
						{dirPath ? <text fg={c.dim}>{dirPath}</text> : null}
						{output ? (
							<DiffContent text={output} maxLines={MAX_DIFF_LINES} />
						) : (
							<text fg={c.dim}>File written</text>
						)}
					</box>
				</box>
			);
		}

		if (tName === 'edit') {
			const path = (argsObj as any)?.path || argsStr;
			const fileName = path ? basename(path) : '';
			const dirPath = path && path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
			const displayTitle = fileName ? `Edit ${fileName}` : 'Edit';
			return (
				<box
					flexDirection="column"
					paddingLeft={2}
					marginTop={mt}
					gap={1}
					backgroundColor={c.bgTool}
					border={['left']}
					customBorderChars={SB}
					borderColor={c.editTool}
				>
					<box paddingTop={1} flexDirection="row" gap={1}>
						<text height={1} fg={c.editTool}>{displayTitle}</text>
						{dirPath ? <text fg={c.dim}> {dirPath}</text> : null}
					</box>
					{output ? (
						<DiffContent text={output} maxLines={MAX_DIFF_LINES} />
					) : (
						<text fg={c.dim} paddingLeft={1}>Edit applied</text>
					)}
				</box>
			);
		}

		if (tName === 'web_fetch') {
			const url = argsObj.url || argsStr;
			const displayTitle = url ? `Fetch ${url}` : 'Fetch';
			if (!output) return <InlineTool icon="↗" title={displayTitle} color={c.info} marginTop={mt} />;
			return (
				<BlockTool title={displayTitle} titleColor={c.info} borderColor={c.info} marginTop={mt}>
					<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
				</BlockTool>
			);
		}

		if (!output) return <InlineTool icon="⚙" title={raw} color={c.dim} marginTop={mt} />;
		const displayTitle = argsStr ? `${tName} ${argsStr}` : tName;
		return (
			<BlockTool title={displayTitle} titleColor={c.tool} marginTop={mt}>
				<TruncatedContent text={output} maxLines={MAX_GENERIC_LINES} />
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
