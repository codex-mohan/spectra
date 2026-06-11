import { useEffect } from 'react';
import { c } from '../theme.js';

export interface UpdateDialogProps {
	newVersion: string;
	currentVersion: string;
	onClose: () => void;
	onInstall: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

export function UpdateDialog({
	newVersion,
	currentVersion,
	onClose,
	onInstall,
	termWidth,
	termHeight,
	registerHandler,
}: UpdateDialogProps) {
	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape') {
				onClose();
			}
			if (key.name === 'return' || key.name === 'enter') {
				onInstall();
			}
		};
		registerHandler?.(handler);
	}, [onClose, onInstall, registerHandler]);

	const mw = Math.min(52, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = 11;
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
					<text fg={c.accent} attributes={1} height={1}>
						Update Available
					</text>
					<text fg={c.dim} height={1}>
						esc
					</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box flexDirection="column" paddingX={2} paddingTop={1} gap={1} flexGrow={1}>
					<box flexDirection="row" gap={1}>
						<text fg={c.text}>New version:</text>
						<text fg={c.success} attributes={1}>
							v{newVersion}
						</text>
					</box>
					<box flexDirection="row" gap={1}>
						<text fg={c.dim}>Current:</text>
						<text fg={c.dim}>v{currentVersion}</text>
					</box>
					<box>
						<text fg={c.dim}>Run the following to update:</text>
					</box>
					<box backgroundColor={c.bgBar} paddingX={2} paddingY={1}>
						<text fg={c.text}>bun update -g @mohanscodex/spectra-code</text>
					</box>
				</box>
				<box paddingX={2} paddingY={1} paddingBottom={1} flexDirection="row" justifyContent="space-between">
					<text fg={c.dim}>esc dismiss</text>
					<text fg={c.accent}>enter copy command</text>
				</box>
			</box>
		</box>
	);
}
