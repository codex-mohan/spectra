import { useEffect } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import { VERSION } from '../utils/version.js';

export interface AboutDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

export function AboutDialog({ onClose, termWidth, termHeight, registerHandler }: AboutDialogProps) {
	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={50}
			height={14}
			top="upper"
			title="About"
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			<box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
				<box>
					<text fg={c.text}>Spectra Code</text>
					<text fg={c.dim}>Version {VERSION}</text>
				</box>
				<box>
					<text fg={c.dim}>Minimal, ultra-fast AI coding agent</text>
					<text fg={c.dim}>Built with Spectra SDK</text>
				</box>
			</box>
		</ModalFrame>
	);
}
