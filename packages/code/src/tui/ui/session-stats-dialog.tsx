import { useEffect } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import { formatCost, formatTokens, isFreeModel } from '@mohanscodex/spectra-ai';
import { lookupContextWindow } from '../utils/model-config.js';

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
	elapsedMs: number | null;
	tokPerSec: number | null;
	contextTokens: number;
	sessionTokens: { input: number; output: number };
	costSoFar: number;
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
	elapsedMs,
	tokPerSec,
	contextTokens,
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
	const totalSessionTokens = sessionTokens.input + sessionTokens.output;
	const cost = costSoFar > 0
		? formatCost(costSoFar)
		: selectedModel && isFreeModel(selectedModel)
			? 'Free'
			: 'n/a';

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={62}
			height={25}
			top="upper"
			title="Session Stats"
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			{({ innerWidth }) => (
				<box flexDirection="column" paddingX={2} gap={0} flexGrow={1}>
					<StatRow label="Agent" value={selectedAgent || 'none'} />
					<StatRow label="Model" value={selectedModel || 'none'} />
					<StatRow label="Provider" value={provider || 'none'} />
					<StatRow label="Thinking" value={thinkingEffort || 'default'} />
					<StatRow label="Services" value={`${mcpCount} MCP · ${customProviderCount} custom provider${customProviderCount === 1 ? '' : 's'}`} />

					<Divider width={innerWidth} />
					<StatRow label="Turns" value={String(turnCount)} />
					<StatRow label="Messages" value={String(messagesLength)} />
					<StatRow label="Last turn" value={elapsedMs == null ? 'n/a' : `${(elapsedMs / 1000).toFixed(1)}s`} />
					<StatRow label="Output rate" value={tokPerSec != null && tokPerSec > 0 ? `${tokPerSec.toFixed(1)} tok/s` : 'n/a'} />

					<Divider width={innerWidth} />
					<StatRow
						label="Context"
						value={contextWindow
							? `${formatTokens(contextTokens)} / ${formatTokens(contextWindow)} (${contextPct}%)`
							: contextTokens > 0 ? `${formatTokens(contextTokens)} / unknown` : 'none'}
					/>
					<StatRow label="Session input" value={formatTokens(sessionTokens.input)} />
					<StatRow label="Session output" value={formatTokens(sessionTokens.output)} />
					<StatRow label="Session total" value={formatTokens(totalSessionTokens)} />

					<Divider width={innerWidth} />
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.accent}>Accumulated cost</text>
						<text fg={cost === 'Free' ? c.warn : c.accent}>{cost}</text>
					</box>
				</box>
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
