import { useEffect } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import { formatCost, formatTokens, isFreeModel } from '@mohanscodex/spectra-ai';
import { lookupContextWindow } from '../utils/model-config.js';
import type { SessionTurnTokens } from '../utils/session-messages.js';

export interface SessionStatsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
	selectedModel: string | null;
	provider: string | null;
	selectedAgent: string;
	thinkingEffort?: string;
	mcpCount: number;
	customProviderCount: number;
	turnCount: number;
	messagesLength: number;
	toolCallCount: number;
	elapsedMs: number | null;
	avgTurnMs: number | null;
	tokPerSec: number | null;
	contextTokens: number;
	contextReserveTokens: number | null;
	sessionTokens: SessionTurnTokens;
	costSoFar: number;
}

function formatDuration(ms: number | null): string {
	if (ms == null || !Number.isFinite(ms)) return 'n/a';
	if (ms < 1000) return `${Math.round(ms)}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function SessionStatsDialog({
	onClose,
	termWidth,
	termHeight,
	registerHandler,
	selectedModel,
	provider,
	selectedAgent,
	thinkingEffort,
	mcpCount,
	customProviderCount,
	turnCount,
	messagesLength,
	toolCallCount,
	elapsedMs,
	avgTurnMs,
	tokPerSec,
	contextTokens,
	contextReserveTokens,
	sessionTokens,
	costSoFar,
}: SessionStatsDialogProps) {
	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') onClose();
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const contextWindow = selectedModel ? lookupContextWindow(selectedModel, provider) : null;
	const contextPct = contextWindow ? Math.round((contextTokens / contextWindow) * 100) : null;
	const cachePromptTokens = sessionTokens.input + sessionTokens.cacheRead + sessionTokens.cacheWrite;
	const totalSessionTokens = cachePromptTokens + sessionTokens.output;
	const hasCache = sessionTokens.cacheRead > 0 || sessionTokens.cacheWrite > 0;
	const cacheHitRate = sessionTokens.cacheRead > 0
		? Math.round((sessionTokens.cacheRead / (sessionTokens.cacheRead + sessionTokens.input)) * 100)
		: null;
	const cost = costSoFar > 0
		? formatCost(costSoFar)
		: selectedModel && isFreeModel(selectedModel)
			? 'Free'
			: 'n/a';
	const costPerTurn = costSoFar > 0 && turnCount > 0 ? `$${(costSoFar / turnCount).toFixed(4)}/turn` : null;
	const tokensPerTurn = turnCount > 0 ? Math.round(totalSessionTokens / turnCount) : null;
	const height = Math.min(termHeight - 2, 30);

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={64}
			height={height}
			top="upper"
			title="Session Stats"
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			{({ height: modalHeight, innerWidth }) => (
				<scrollbox maxHeight={modalHeight - 5} paddingX={2} scrollY={true} scrollbarOptions={{ visible: false }}>
					<box flexDirection="column">
						<StatRow label="Agent" value={selectedAgent || 'none'} />
						<StatRow label="Model" value={selectedModel || 'none'} />
						<StatRow label="Provider" value={provider || 'none'} />
						<StatRow label="Thinking" value={thinkingEffort || 'default'} />
						<StatRow label="Services" value={`${mcpCount} MCP · ${customProviderCount} custom provider${customProviderCount === 1 ? '' : 's'}`} />

						<Divider width={innerWidth} />
						<StatRow label="Turns" value={String(turnCount)} />
						<StatRow label="Messages" value={String(messagesLength)} />
						<StatRow label="Tool calls" value={String(toolCallCount)} />
						<StatRow
							label="Last turn"
							value={elapsedMs == null
								? 'n/a'
								: `${formatDuration(elapsedMs)}${tokPerSec != null && tokPerSec > 0 ? ` · ${tokPerSec.toFixed(1)} tok/s` : ''}`}
						/>
						<StatRow label="Avg turn" value={formatDuration(avgTurnMs)} />

						<Divider width={innerWidth} />
						<StatRow
							label="Context"
							value={contextWindow
								? `${formatTokens(contextTokens)} / ${formatTokens(contextWindow)} (${contextPct}%)`
								: contextTokens > 0 ? `${formatTokens(contextTokens)} / unknown` : 'none'}
						/>
						{contextReserveTokens != null && contextWindow ? (
							<StatRow
								label="Autocompact"
								value={`${formatTokens(contextReserveTokens)} reserve · ${formatTokens(Math.max(0, contextWindow - contextTokens - contextReserveTokens))} free`}
							/>
						) : null}

						<Divider width={innerWidth} />
						<StatRow label="Session input" value={formatTokens(sessionTokens.input)} />
						<StatRow label="Session output" value={formatTokens(sessionTokens.output)} />
						{hasCache ? <StatRow label="Cache read" value={formatTokens(sessionTokens.cacheRead)} /> : null}
						{hasCache ? <StatRow label="Cache write" value={formatTokens(sessionTokens.cacheWrite)} /> : null}
						{cacheHitRate != null ? (
							<StatRow label="Cache hit" value={`${cacheHitRate}% of ${formatTokens(cachePromptTokens)} prompt tokens`} />
						) : null}
						<StatRow label="Session total" value={formatTokens(totalSessionTokens)} />
						{tokensPerTurn != null ? <StatRow label="Avg per turn" value={formatTokens(tokensPerTurn)} /> : null}

						<Divider width={innerWidth} />
						<box flexDirection="row" justifyContent="space-between">
							<text fg={c.accent}>Accumulated cost</text>
							<box flexDirection="row" gap={2}>
								{costPerTurn ? <text fg={c.dim}>{costPerTurn}</text> : null}
								<text fg={cost === 'Free' ? c.warn : c.accent}>{cost}</text>
							</box>
						</box>
					</box>
				</scrollbox>
			)}
		</ModalFrame>
	);
}

function StatRow({ label, value }: { label: string; value: string }) {
	return (
		<box flexDirection="row" justifyContent="space-between">
			<text fg={c.dim}>{label}</text>
			<text fg={c.text}>{value}</text>
		</box>
	);
}

function Divider({ width }: { width: number }) {
	return (
		<box height={1} paddingX={0}>
			<text fg={c.border}>{'─'.repeat(width)}</text>
		</box>
	);
}
