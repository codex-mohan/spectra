import { useEffect } from 'react';
import { c } from '../theme.js';
import { calculateCost, formatCost, formatTokens, getModelPricing, isFreeModel } from '@mohanscodex/spectra-ai';
import { lookupContextWindow } from '../utils/model-config.js';

export interface CostDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
	selectedModel: string;
	provider: string;
	tokenUsage: { input: number; output: number };
}

export function CostDialog({ onClose, termWidth, termHeight, registerHandler, selectedModel, provider, tokenUsage }: CostDialogProps) {
	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const pricing = getModelPricing(selectedModel);
	const cost = calculateCost(selectedModel, tokenUsage);
	const ctxMax = lookupContextWindow(selectedModel, provider);
	const totalTokens = tokenUsage.input + tokenUsage.output;
	const ctxPct = ctxMax ? Math.round((totalTokens / ctxMax) * 100) : null;
	const free = isFreeModel(selectedModel);

	const mw = Math.min(56, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = pricing ? 18 : 14;
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box
					height={1}
					paddingX={2}
					paddingTop={1}
					paddingBottom={1}
					flexDirection="row"
					justifyContent="space-between"
					backgroundColor={c.bgCard}
				>
					<text fg={c.accent}>Session Cost</text>
					<text fg={c.dim}>esc</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={0} flexGrow={1}>
					{/* Model */}
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.dim}>Model</text>
						<text fg={c.text}>{selectedModel}</text>
					</box>
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.dim}>Provider</text>
						<text fg={c.text}>{provider}</text>
					</box>

					<box height={1} paddingX={0}>
						<text fg={c.border}>{'─'.repeat(innerW)}</text>
					</box>

					{/* Token usage */}
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.dim}>Input tokens</text>
						<text fg={c.text}>{formatTokens(tokenUsage.input)}{free ? '' : ` → ${formatCost(cost.input)}`}</text>
					</box>
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.dim}>Output tokens</text>
						<text fg={c.text}>{formatTokens(tokenUsage.output)}{free ? '' : ` → ${formatCost(cost.output)}`}</text>
					</box>

					{/* Context window */}
					{ctxMax && (
						<box flexDirection="row" justifyContent="space-between">
							<text fg={c.dim}>Context window</text>
							<text fg={c.text}>{formatTokens(totalTokens)} / {formatTokens(ctxMax)}{ctxPct != null ? ` (${ctxPct}%)` : ''}</text>
						</box>
					)}

					{/* Per-token rates */}
					{pricing && !free && (
						<>
							<box height={1} paddingX={0}>
								<text fg={c.border}>{'─'.repeat(innerW)}</text>
							</box>
							<box flexDirection="row" justifyContent="space-between">
								<text fg={c.dim}>Input rate</text>
								<text fg={c.text}>${pricing.input.toFixed(2)} / 1M tokens</text>
							</box>
							<box flexDirection="row" justifyContent="space-between">
								<text fg={c.dim}>Output rate</text>
								<text fg={c.text}>${pricing.output.toFixed(2)} / 1M tokens</text>
							</box>
							{pricing.cacheRead > 0 && (
								<box flexDirection="row" justifyContent="space-between">
									<text fg={c.dim}>Cache read rate</text>
									<text fg={c.text}>${pricing.cacheRead.toFixed(2)} / 1M tokens</text>
								</box>
							)}
						</>
					)}

					{/* Total */}
					<box height={1} paddingX={0}>
						<text fg={c.border}>{'─'.repeat(innerW)}</text>
					</box>
					<box flexDirection="row" justifyContent="space-between">
						<text fg={c.accent}>Total cost</text>
						<text fg={free ? c.warn : c.accent}>{free ? 'Free model' : formatCost(cost.total)}</text>
					</box>
				</box>
				<box paddingX={2} paddingY={1} paddingBottom={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>esc/enter close</text>
				</box>
			</box>
		</box>
	);
}
