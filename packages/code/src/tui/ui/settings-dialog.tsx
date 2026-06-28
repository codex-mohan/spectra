import { useEffect, useState } from 'react';
import { c } from '../theme.js';
import { loadConfig, saveConfig, type SpectraConfig } from '../../services/config.js';

interface SettingsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
}

export function SettingsDialog({ onClose, termWidth, termHeight, registerHandler }: SettingsDialogProps) {
	const [config, setConfig] = useState<SpectraConfig>({});
	const [focusIdx, setFocusIdx] = useState(0);

	useEffect(() => {
		setConfig(loadConfig());
	}, []);

	useEffect(() => {
		const handler = (key: any) => {
			if (key.name === 'escape' || key.name === 'return' || key.name === 'enter') {
				onClose();
				return;
			}
			if (key.name === 'up' && focusIdx > 0) setFocusIdx(focusIdx - 1);
			if (key.name === 'down' && focusIdx < 1) setFocusIdx(focusIdx + 1);
			if (key.name === 'return' || key.name === 'enter' || key.name === 'space') {
				toggle(focusIdx);
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, focusIdx]);

	const toggle = (idx: number) => {
		const skills = { ...(config.skills || {}) };
		if (idx === 0) {
			skills.autoSynthesize = skills.autoSynthesize === false ? true : false;
		} else if (idx === 1) {
			skills.confirmBeforeSave = skills.confirmBeforeSave === false ? true : false;
		}
		const updated = { ...config, skills };
		setConfig(updated);
		saveConfig(updated);
	};

	const autoSynth = config.skills?.autoSynthesize !== false;
	const confirmSave = config.skills?.confirmBeforeSave !== false;

	const mw = Math.min(55, termWidth - 4);
	const ml = Math.floor((termWidth - mw) / 2);
	const mh = 14;
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = mw - 4;

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<text fg={c.accent} attributes={1}>Settings</text>
					<text fg={c.dim}>esc close</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.accent} attributes={1}>Skills</text>
				</box>
				<box flexDirection="column" paddingX={2} gap={1} flexGrow={1}>
					<box flexDirection="row" gap={1}>
						<text fg={focusIdx === 0 ? c.accent : c.dim}>{focusIdx === 0 ? '▸ ' : '  '}</text>
						<text fg={c.text}>Auto-synthesize skills</text>
						<text fg={autoSynth ? c.success : c.dim}>{autoSynth ? ' [ON]' : ' [OFF]'}</text>
					</box>
					<box flexDirection="row" gap={1}>
						<text fg={focusIdx === 1 ? c.accent : c.dim}>{focusIdx === 1 ? '▸ ' : '  '}</text>
						<text fg={c.text}>Confirm before saving skills</text>
						<text fg={confirmSave ? c.success : c.dim}>{confirmSave ? ' [ON]' : ' [OFF]'}</text>
					</box>
				</box>
				<box height={1} paddingX={2} paddingBottom={1} flexDirection="row" gap={2}>
					<text fg={c.dim}>↑↓ navigate</text>
					<text fg={c.dim}>enter/space toggle</text>
					<text fg={c.dim}>esc close</text>
				</box>
			</box>
		</box>
	);
}
