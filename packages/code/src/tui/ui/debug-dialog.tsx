import { useMemo, useEffect } from 'react';
import { c } from '../theme.js';
import { ModalFrame } from './modal-frame.js';
import { loadConfig } from '../../services/config.js';
import { listConnectedServers } from '../../integrations/mcp/index.js';
import { readAll } from '../../services/auth-store.js';
import { getGlobalConfigDir, getGlobalDataDir } from '../../utils/paths.js';
import { getPlatformInfo } from '../../utils/platform.js';
import type { SessionStore } from '../../services/session-store.js';
import { titlecase } from '../utils.js';
import { VERSION } from '../utils/version.js';

export interface DebugDialogProps {
	termWidth: number;
	termHeight: number;
	selectedModel: string | null;
	provider: string | null;
	selectedAgent: string;
	thinkingEffort?: string;
	sessionStore: SessionStore;
	mcpCount: number;
	onClose: () => void;
	registerHandler: (fn: ((key: any) => void) | null) => void;
}

export function DebugDialog(props: DebugDialogProps) {
	const {
		termWidth,
		termHeight,
		selectedModel,
		provider,
		selectedAgent,
		thinkingEffort,
		sessionStore,
		mcpCount,
		onClose,
		registerHandler,
	} = props;


	const info = useMemo(() => {
		const config = loadConfig();
		const connected = listConnectedServers();
		const authStore = readAll();
		const platform = getPlatformInfo();
		const sessions = sessionStore.list(process.cwd());

		const configDir = getGlobalConfigDir();
		const dataDir = getGlobalDataDir();

		const groups: { title?: string; rows: { label: string; value: string }[] }[] = [
			{
				rows: [
					{ label: 'Version', value: VERSION },
					{ label: 'Directory', value: platform.cwd },
					{ label: 'Platform', value: `${platform.os} (${platform.arch})` },
					{ label: 'Shell', value: platform.shell },
				],
			},
			{
				rows: [
					{ label: 'Agent', value: titlecase(selectedAgent) },
					{ label: 'Model', value: selectedModel || '(none)' },
					{ label: 'Provider', value: provider || '(none)' },
					{ label: 'Thinking effort', value: thinkingEffort || 'default' },
				],
			},
			{
				rows: [
					{ label: 'MCP servers', value: `${config.mcp?.length ?? 0} configured, ${mcpCount} connected` },
					{ label: 'Sessions', value: `${sessions.length} total` },
					{ label: 'Auth keys', value: `${Object.keys(authStore).length} provider(s)` },
				],
			},
			{
				rows: [
					{ label: 'Config dir', value: configDir },
					{ label: 'Data dir', value: dataDir },
				],
			},
		];
		return groups;
	}, [selectedModel, provider, selectedAgent, thinkingEffort, sessionStore, mcpCount]);

	const maxLabel = useMemo(() => Math.max(...info.flatMap((g) => g.rows.map((r) => r.label.length))), [info]);

	useEffect(() => {
		registerHandler((key: any) => {
			if (key.name === 'escape') {
				onClose();
				return;
			}
		});
		return () => registerHandler(null);
	}, [onClose, registerHandler]);

	return (
		<ModalFrame
			termWidth={termWidth}
			termHeight={termHeight}
			width={64}
			height={Math.min(24, termHeight - 4)}
			title="Debug"
			footer={<text fg={c.dim}>esc/enter close</text>}
		>
			{({ height }) => (
				<scrollbox maxHeight={height - 5} paddingX={2} scrollY={true} scrollbarOptions={{ visible: false }}>
					<box flexDirection="column">
						{info.map((group, gi) => (
							<box key={gi} flexDirection="column">
								{gi > 0 ? <box height={1} /> : null}
								{group.rows.map((row, i) => {
									const pad = maxLabel - row.label.length + 1;
									return (
										<box key={i} height={1} flexDirection="row">
											<text fg={c.dim}>{row.label}:</text>
											<text fg={c.text}>
												{' '.repeat(pad)}
												{row.value}
											</text>
										</box>
									);
								})}
							</box>
						))}
					</box>
				</scrollbox>
			)}
		</ModalFrame>
	);
}
