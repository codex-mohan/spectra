import { useEffect } from 'react';
import open from 'open';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import { VERSION } from '../utils/version.js';
import { getGlobalConfigDir } from '../../utils/paths.js';

export interface AboutDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: unknown) => void) => void;
}

const S_ROWS = [
	'███████',
	'██     ',
	'██     ',
	'███████',
	'     ██',
	'███████',
];

// Vertical cyan-to-blue ramp, matching the home wordmark.
const S_COLORS = [c.accent, '#70C3D5', '#72BDDB', '#74B8E0', '#76B3E5', c.blue];

function GradientMark() {
	return (
		<box flexDirection="column" width={7} flexShrink={0}>
			{S_ROWS.map((row, index) => (
				<box key={`s-row-${index}`} height={1} width={7}>
					<text fg={S_COLORS[index]}>{row.replaceAll(' ', '\u00A0')}</text>
				</box>
			))}
		</box>
	);
}

function MetaRow({ label, value }: { label: string; value: string }) {
	return (
		<box flexDirection="row" height={1}>
			<box width={9} flexShrink={0}>
				<text fg={c.dim}>{label}</text>
			</box>
			<text fg={c.text} overflow="hidden" wrapMode="none">{value}</text>
		</box>
	);
}

export function AboutDialog({ onClose, termWidth, termHeight, registerHandler }: AboutDialogProps) {
	useEffect(() => {
		const handler = (key: unknown) => {
			if (!key || typeof key !== 'object' || !('name' in key)) return;
			const name = key.name;
			if (name === 'escape' || name === 'return' || name === 'enter') {
				onClose();
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler]);

	const runtime = process.versions.bun ? `Bun ${process.versions.bun}` : `Node ${process.versions.node}`;
	const platform = `${process.platform} ${process.arch}`;
	const compact = termWidth < 70;

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={62}
			height={14}
			top="upper"
			title="About"
			footer={<text fg={c.dim}>esc / enter close</text>}
		>
			<box flexDirection="row" paddingX={2} paddingTop={1}>
				<GradientMark />
				<box width={3} flexShrink={0} />
				<box flexDirection="column" flexGrow={1}>
					<box flexDirection="row" height={1} gap={1}>
						<text fg={c.text} attributes={1}>Spectra Code</text>
						<text fg={c.dim}>v{VERSION}</text>
					</box>
					<box height={1}>
						<text fg={c.subtext}>Minimal, ultra-fast AI agent</text>
					</box>
					<MetaRow label="Runtime" value={runtime} />
					<MetaRow label="Platform" value={platform} />
					{!compact && <MetaRow label="Config" value={getGlobalConfigDir()} />}
					{!compact && <box height={1} />}
					{!compact && (
						<box
							height={1}
							onMouseUp={() => { void open('https://github.com/codex-mohan/spectra').catch(() => {}); }}
						>
							<text fg={c.info}>github.com/codex-mohan/spectra</text>
						</box>
					)}
				</box>
			</box>
		</ModalFrame>
	);
}
