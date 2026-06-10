import { useState } from 'react';
import type { PermissionRequest } from '../../security/types.js';
import { c } from '../theme.js';
import { useKeyboard } from '@opentui/react';

export interface PermissionDialogProps {
	request: PermissionRequest;
	termWidth: number;
	termHeight: number;
	onAllow: (id: string) => void;
	onAllowAlways: (id: string) => void;
	onDeny: (id: string) => void;
	onClose: () => void;
}

export function PermissionDialog({
	request,
	termWidth,
	termHeight,
	onAllow,
	onAllowAlways,
	onDeny,
	onClose,
}: PermissionDialogProps) {
	const [selected, setSelected] = useState(0);
	const options = [
		{ label: 'Allow Once', action: () => onAllow(request.id) },
		{ label: 'Allow Always', action: () => onAllowAlways(request.id) },
		{ label: 'Deny', action: () => onDeny(request.id) },
	];

	useKeyboard((key) => {
		if (key.name === 'escape') {
			onClose();
			return;
		}
		if (key.name === 'return' || key.name === 'enter') {
			options[selected].action();
			return;
		}
		if (key.name === 'left' || key.name === 'up') {
			setSelected((p) => (p > 0 ? p - 1 : options.length - 1));
			return;
		}
		if (key.name === 'right' || key.name === 'down') {
			setSelected((p) => (p < options.length - 1 ? p + 1 : 0));
			return;
		}
	});

	const dialogWidth = Math.min(64, termWidth - 8);
	const dialogLeft = Math.floor((termWidth - dialogWidth) / 2);
	const innerWidth = dialogWidth - 4;
	const dialogHeight = 12;
	const dialogTop = Math.max(1, Math.floor((termHeight - dialogHeight) / 2));

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box
				position="absolute"
				left={dialogLeft}
				top={dialogTop}
				width={dialogWidth}
				height={dialogHeight}
				backgroundColor={c.bg}
			>
				{/* Title */}
				<box height={1} paddingTop={1} paddingX={2} flexDirection="row" justifyContent="center">
					<text fg={c.accent} attributes={1}>
						Spectra Permission
					</text>
				</box>

				<box height={1} />

				{/* Info rows */}
				<box paddingX={2} flexDirection="column">
					<box height={1} flexDirection="row" gap={1}>
						<text fg={c.dim} flexShrink={0}>
							Tool:
						</text>
						<text fg={c.text} overflow="hidden" wrapMode="none" flexGrow={1}>
							{request.tool ?? request.permission}
						</text>
					</box>
					<box height={1} flexDirection="row" gap={1}>
						<text fg={c.dim} flexShrink={0}>
							Pattern:
						</text>
						<text fg={c.info} overflow="hidden" wrapMode="none" flexGrow={1}>
							{request.permission} {request.pattern}
						</text>
					</box>
				</box>

				{/* Separator */}
				<box height={1} paddingX={2} paddingTop={1}>
					<text fg={c.border}>{'─'.repeat(innerWidth)}</text>
				</box>

				{/* Options */}
				<box height={1} paddingX={2} flexDirection="row" justifyContent="center" gap={2}>
					{options.map((opt, i) => (
						<box key={opt.label} flexDirection="row" gap={1}>
							<text fg={i === selected ? c.accent : c.dim}>{i === selected ? '▸' : ' '}</text>
							<text
								fg={i === selected ? (i === 2 ? c.error : c.accent) : c.dim}
								attributes={i === selected ? 1 : 0}
							>
								{opt.label}
							</text>
							<text fg={i === selected ? c.accent : c.dim}>{i === selected ? '◂' : ' '}</text>
						</box>
					))}
				</box>

				{/* Footer */}
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
					<text fg={c.dim}>← → select · enter confirm · esc close</text>
				</box>
			</box>
		</box>
	);
}
