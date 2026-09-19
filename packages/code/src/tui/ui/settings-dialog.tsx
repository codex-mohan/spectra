import { useEffect } from 'react';
import { c } from '../theme.js';

interface SettingsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

export function SettingsDialog({ onClose, termWidth, termHeight, registerHandler }: SettingsDialogProps) {
	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const mw = Math.min(55, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = 12;
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<text fg={c.accent} attributes={1}>Settings</text>
					<text fg={c.dim}>esc</text>
				</box>
				<box height={1} />
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.accent} attributes={1}>Skills</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
					<box flexDirection="row" gap={1}>
						<text fg={c.text}>Creation</text>
						<text fg={c.success}>explicit proposals</text>
					</box>
					<box flexDirection="row" gap={1}>
						<text fg={c.text}>Review</text>
						<text fg={c.success}>always required</text>
					</box>
					<text fg={c.dim}>Use /skills to approve or reject proposals.</text>
				</box>
				<box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center" gap={2}>
					<text fg={c.dim}>enter/esc close</text>
				</box>
			</box>
		</box>
	);
}
