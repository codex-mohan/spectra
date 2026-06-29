import { useEffect } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';

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


	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={52}
			height={11}
			top="upper"
			title="Update Available"
			footer={
				<>
					<text fg={c.dim}>esc dismiss</text>
					<text fg={c.accent}>enter copy command</text>
				</>
			}
			footerJustify="space-between"
		>
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
		</ModalFrame>
	);
}
