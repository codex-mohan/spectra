import { useEffect } from 'react';
import { formatTokens } from '@mohanscodex/spectra-ai';
import type { ContextBreakdown, ContextColor } from '../../services/context-usage.js';
import { CONTEXT_GRID_COLUMNS, CONTEXT_GRID_ROWS, CONTEXT_GLYPH_FREE, CONTEXT_GLYPH_RESERVE } from '../../services/context-usage.js';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';

export interface ContextUsageDialogProps {
	breakdown?: ContextBreakdown;
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (handler: (key: unknown) => void) => void;
}

function colorFor(color: ContextColor): string {
	switch (color) {
		case 'accent': return c.accent;
		case 'warning': return c.tool;
		case 'context': return c.warn;
		case 'success': return c.success;
		case 'messages': return c.text;
		case 'dim': return c.dim;
	}
}

function percent(part: number, whole: number): string {
	if (whole <= 0) return '0.0%';
	return `${((part / whole) * 100).toFixed(1)}%`;
}

function ContextGrid({ breakdown }: { breakdown: ContextBreakdown }) {
	return (
		<box flexDirection="column" flexShrink={0}>
			{Array.from({ length: CONTEXT_GRID_ROWS }, (_, row) => (
				<box key={row} flexDirection="row" height={1}>
					{breakdown.cells
						.slice(row * CONTEXT_GRID_COLUMNS, (row + 1) * CONTEXT_GRID_COLUMNS)
						.map((cell, column) => (
							<text key={column} fg={colorFor(cell.color)}>{cell.glyph}{column < CONTEXT_GRID_COLUMNS - 1 ? ' ' : ''}</text>
						))}
				</box>
			))}
		</box>
	);
}

function LegendRow({ glyph, color, label, tokens, total, estimated }: {
	glyph: string;
	color: ContextColor;
	label: string;
	tokens: number;
	total: number;
	estimated: boolean;
}) {
	return (
		<box flexDirection="row" height={1}>
			<text fg={colorFor(color)}>{glyph}</text>
			<text fg={c.text}> {label}: </text>
			<text fg={c.text}>{estimated ? '~' : ''}{formatTokens(tokens)}</text>
			<text fg={c.dim}> tokens ({percent(tokens, total)})</text>
		</box>
	);
}

function ContextLegend({ breakdown }: { breakdown: ContextBreakdown }) {
	return (
		<box flexDirection="column" flexShrink={0}>
			<text fg={c.subtext}>Estimated usage by category</text>
			{breakdown.categories.map((category) => (
				<LegendRow
					key={category.id}
					glyph={category.glyph}
					color={category.color}
					label={category.label}
					tokens={category.tokens}
					total={breakdown.contextWindow}
					estimated={category.estimated}
				/>
			))}
			<LegendRow glyph={CONTEXT_GLYPH_FREE} color="dim" label="Free space" tokens={breakdown.freeTokens} total={breakdown.contextWindow} estimated={false} />
			<LegendRow glyph={CONTEXT_GLYPH_RESERVE} color="warning" label="Autocompact buffer" tokens={breakdown.reserveTokens} total={breakdown.contextWindow} estimated={false} />
		</box>
	);
}

export function ContextUsageDialog({
	breakdown,
	onClose,
	termWidth,
	termHeight,
	registerHandler,
}: ContextUsageDialogProps) {
	useEffect(() => {
		const handler = (key: unknown) => {
			if (!key || typeof key !== 'object' || !('name' in key)) return;
			const name = Reflect.get(key, 'name');
			if (name === 'escape' || name === 'return' || name === 'enter') onClose();
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const wide = termWidth >= 96;
	const height = Math.max(12, Math.min(wide ? 19 : 29, termHeight - 2));
	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={wide ? 94 : 58}
			height={height}
			top="upper"
			title="Context Usage"
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			{({ height: modalHeight }) => (
				<scrollbox maxHeight={modalHeight - 5} paddingX={2} scrollY={true} scrollbarOptions={{ visible: false }}>
					{breakdown ? (
						<box flexDirection="column">
							<box flexDirection="row" gap={1}>
								<text fg={c.text}>{breakdown.modelId}</text>
								<text fg={c.dim}>({formatTokens(breakdown.contextWindow)} context)</text>
							</box>
							<box flexDirection="row" gap={0}>
								<text fg={c.text}>{formatTokens(breakdown.usedTokens)}</text>
								<text fg={c.dim}>/{formatTokens(breakdown.contextWindow)} tokens ({percent(breakdown.usedTokens, breakdown.contextWindow)})</text>
								{!breakdown.anchored && <text fg={c.warn}> estimated</text>}
							</box>
							<box height={1} />
							<box flexDirection={wide ? 'row' : 'column'} gap={wide ? 4 : 1}>
								<ContextGrid breakdown={breakdown} />
								<ContextLegend breakdown={breakdown} />
							</box>
						</box>
					) : (
						<box flexDirection="column" gap={1}>
							<text fg={c.text}>No prepared context snapshot yet.</text>
							<text fg={c.dim}>Send a message first; local estimates are used when the provider omits usage.</text>
						</box>
					)}
				</scrollbox>
			)}
		</ModalFrame>
	);
}
