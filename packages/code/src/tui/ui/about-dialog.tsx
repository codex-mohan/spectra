import { useEffect } from 'react';
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

// The same cyan-to-blue ramp as the home wordmark.
const S_COLORS = [c.accent, '#70C3D5', '#72BDDB', '#74B8E0', '#76B3E5', '#78ADEB', c.blue];

function GradientMark() {
	return (
		<box flexDirection="column" width={7} flexShrink={0}>
			{S_ROWS.map((row, rowIndex) => {
				const runs: { text: string; color: string }[] = [];
				for (let index = 0; index < row.length; index++) {
					if (row[index] === ' ') continue;
					let end = index;
					while (end < row.length && row[end] !== ' ') end++;
					runs.push({ text: row.slice(index, end), color: S_COLORS[Math.min(index, S_COLORS.length - 1)] });
					index = end - 1;
				}
				return (
					<box key={`s-row-${rowIndex}`} flexDirection="row" height={1}>
						{runs.map((run, runIndex) => (
							<text key={`s-run-${rowIndex}-${runIndex}`} fg={run.color}>{run.text}</text>
						))}
					</box>
				);
			})}
		</box>
	);
}

function MetaRow({ label, value }: { label: string; value: string }) {
	return (
		<box flexDirection="row">
			<text fg={c.dim} width={11}>{label}</text>
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
	const configDir = getGlobalConfigDir();
	const compact = termWidth < 70;

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={66}
			height={16}
			top="upper"
			title="About"
			footer={<text fg={c.dim}>esc / enter close</text>}
		>
			<box flexDirection="row" paddingX={2} paddingTop={1} gap={3} flexGrow={1}>
				<GradientMark />
				<box flexDirection="column" gap={1} flexGrow={1}>
					<box flexDirection="row" gap={1}>
						<text fg={c.text} attributes={1}>Spectra Code</text>
						<text fg={c.dim}>v{VERSION}</text>
					</box>
					<box flexDirection="column">
						<text fg={c.subtext}>Minimal, ultra-fast</text>
						<text fg={c.subtext}>multi-language AI agent</text>
					</box>
					<box flexDirection="column">
						<MetaRow label="Runtime" value={runtime} />
						<MetaRow label="Platform" value={platform} />
						{!compact && <MetaRow label="Config" value={configDir} />}
					</box>
					{!compact && <text fg={c.dim}>github.com/codex-mohan/spectra</text>}
				</box>
			</box>
		</ModalFrame>
	);
}
