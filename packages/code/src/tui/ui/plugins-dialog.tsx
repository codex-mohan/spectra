import { useEffect, useState } from 'react';
import { c } from '../theme.js';
import { pluginHost } from '../../plugins/host.js';
import { showToast } from '../components/toast.js';
import type { LoadedPlugin } from '../../runtime/types.js';

interface PluginsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: ((key: any) => void) | null) => void;
	onChanged?: () => void;
}

function stateColor(state: LoadedPlugin['state']): string {
	switch (state) {
		case 'active': return c.success;
		case 'failed': return c.error;
		case 'loading': return c.warn;
		default: return c.dim;
	}
}

export function PluginsDialog({ onClose, termWidth, termHeight, registerHandler, onChanged }: PluginsDialogProps) {
	const [plugins, setPlugins] = useState<LoadedPlugin[]>(() => pluginHost.list());
	const [selected, setSelected] = useState(0);

	const refresh = () => {
		const next = pluginHost.list();
		setPlugins(next);
		setSelected((current) => Math.max(0, Math.min(current, next.length - 1)));
	};

	useEffect(() => {
		const handler = async (rawKey: any) => {
			const name = rawKey && typeof rawKey === 'object' ? rawKey.name : '';
			if (name === 'escape') { onClose(); return; }
			if (name === 'up' && selected > 0) { setSelected(selected - 1); return; }
			if (name === 'down' && selected < plugins.length - 1) { setSelected(selected + 1); return; }
			const plugin = plugins[selected];
			if (!plugin) return;
			if (name === 'return' || name === 'enter') {
				await pluginHost.setEnabled(plugin.id, !plugin.enabled);
				refresh();
				onChanged?.();
				showToast(`${plugin.enabled ? 'Disabled' : 'Enabled'} ${plugin.id}`, 'info');
				return;
			}
			if (name === 'r') {
				await pluginHost.reload(plugin.id);
				refresh();
				onChanged?.();
				showToast(`Reloaded ${plugin.id}`, 'info');
			}
		};
		registerHandler?.(handler);
	}, [onClose, registerHandler, selected, plugins, onChanged]);

	const mw = Math.min(82, termWidth - 4);
	const ml = Math.max(0, Math.floor((termWidth - mw) / 2));
	const mh = Math.min(22, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = Math.max(1, mw - 4);
	const listH = Math.max(4, mh - 6);

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard} border borderColor={c.border} flexDirection="column">
				<box height={2} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between">
					<text fg={c.accent} attributes={1}>{'\u{f06a5}'} Plugins</text>
					<text fg={c.dim}>enter toggle · r reload · esc close</text>
				</box>
				<box height={1} paddingX={2}><text fg={c.border}>{'─'.repeat(innerW)}</text></box>
				<box height={listH} paddingX={2} flexDirection="column" overflow="hidden">
					{plugins.length === 0 ? <text fg={c.dim}>No plugins discovered. Add one under .spectra/plugins/&lt;id&gt;/plugin.json.</text> : plugins.slice(0, listH).map((plugin, index) => {
						const selectedRow = index === selected;
						const contributions = plugin.contributions;
						return (
							<box key={plugin.id} flexDirection="column" height={2} backgroundColor={selectedRow ? c.bgSelect : c.bgCard} overflow="hidden">
								<text fg={selectedRow ? c.accent : c.text} wrapMode="none" overflow="hidden">
									{selectedRow ? '▸ ' : '  '}{plugin.id}  <span fg={stateColor(plugin.state)}>{plugin.state}</span>
									<span fg={c.dim}>  {plugin.manifest.version ? `v${plugin.manifest.version}  ` : ''}{contributions.tools}t · {contributions.commands}c · {contributions.settings}s</span>
								</text>
								<text fg={plugin.error ? c.error : c.dim} wrapMode="none" overflow="hidden">
									{'  '}{plugin.error ?? plugin.manifest.description ?? ''}
								</text>
							</box>
						);
					})}
				</box>
				<box height={1} paddingX={2} flexDirection="row" justifyContent="space-between">
					<text fg={c.dim}>{plugins.length} discovered</text>
					<text fg={c.dim}>esc</text>
				</box>
			</box>
		</box>
	);
}
