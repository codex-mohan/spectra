import { useEffect, useMemo, useRef, useState } from 'react';
import { c } from '../theme.js';
import { showToast } from '../components/toast.js';
import { getCenteredWindow } from '../utils/selection-window.js';
import { SettingsWriter, watchConfigFiles, type SettingScope, type SettingsTab } from '../../config/registry.js';
import {
	buildSettingRows,
	commitSetting,
	filterSettings,
	nextTab,
	scopeBadge,
	toggleScope,
} from './settings-state.js';

interface SettingsDialogProps {
	onClose: () => void;
	termWidth: number;
	termHeight: number;
	registerHandler?: (fn: (key: any) => void) => void;
	defaultTab?: SettingsTab;
}

interface EditingState {
	label: string;
	path: string;
	text: string;
	error?: string;
	definition: ReturnType<typeof filterSettings>[number];
}

export function SettingsDialog({ onClose, termWidth, termHeight, registerHandler, defaultTab }: SettingsDialogProps) {
	const [tab, setTab] = useState<SettingsTab>(defaultTab ?? 'appearance');
	const [query, setQuery] = useState('');
	const [searching, setSearching] = useState(false);
	const [selected, setSelected] = useState(0);
	const [scope, setScope] = useState<SettingScope>('project');
	const [editing, setEditing] = useState<EditingState | null>(null);
	const [version, setVersion] = useState(0);
	const writer = useRef(new SettingsWriter());

	useEffect(() => () => writer.current.dispose(), []);
	useEffect(() => {
		const stop = watchConfigFiles(process.cwd(), (valid) => {
			if (valid) setVersion((value) => value + 1);
		});
		return stop;
	}, []);

	const definitions = useMemo(() => filterSettings(query, tab), [query, tab]);
	const rows = useMemo(() => buildSettingRows(definitions), [definitions, version]);

	useEffect(() => {
		if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
	}, [rows.length, selected]);

	useEffect(() => {
		const handler = (rawKey: any) => {
			const key = rawKey && typeof rawKey === 'object' ? rawKey as { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } : {};
			const name = key.name ?? '';

			if (editing) {
				if (name === 'escape') {
					setEditing(null);
					return;
				}
				if (name === 'return' || name === 'enter') {
					const result = commitSetting(editing.definition, editing.text, scope);
					if (!result.ok) {
						setEditing({ ...editing, error: result.error });
						return;
					}
					setEditing(null);
					setVersion((value) => value + 1);
					showToast(`Saved ${editing.path} (${scope})`, 'success');
					return;
				}
				if (name === 'backspace') {
					setEditing({ ...editing, text: editing.text.slice(0, -1), error: undefined });
					return;
				}
				if (name === 'space' && !key.ctrl && !key.meta) {
					setEditing({ ...editing, text: `${editing.text} `, error: undefined });
					return;
				}
				if (name.length === 1 && !key.ctrl && !key.meta) {
					setEditing({ ...editing, text: editing.text + name, error: undefined });
				}
				return;
			}

			if (searching) {
				if (name === 'escape') {
					setSearching(false);
					setQuery('');
					setSelected(0);
					return;
				}
				if (name === 'return' || name === 'enter') {
					const row = rows[selected];
					if (row) setEditing({ label: row.definition.label, path: row.definition.path, text: row.display === '(unset)' ? '' : row.display, definition: row.definition });
					return;
				}
				if (name === 'backspace') {
					setQuery((value) => value.slice(0, -1));
					setSelected(0);
					return;
				}
				if (name === 'space') {
					setQuery((value) => `${value} `);
					setSelected(0);
					return;
				}
				if (name.length === 1 && !key.ctrl && !key.meta) {
					setQuery((value) => value + name);
					setSelected(0);
				}
				return;
			}

			if (name === 'escape') { onClose(); return; }
			if (name === 'tab' || name === 'right') {
				setTab((current) => nextTab(current, key.shift ? -1 : 1));
				setQuery('');
				setSelected(0);
				return;
			}
			if (name === 'left') {
				setTab((current) => nextTab(current, -1));
				setQuery('');
				setSelected(0);
				return;
			}
			if (name === 'up' && selected > 0) { setSelected(selected - 1); return; }
			if (name === 'down' && selected < rows.length - 1) { setSelected(selected + 1); return; }
			if (name === 's') {
				setScope((current) => toggleScope(current));
				return;
			}
			if (name === 'r') {
				const row = rows[selected];
				if (!row) return;
				writer.current.reset(scope, row.definition.path);
				void writer.current.flush();
				setVersion((value) => value + 1);
				showToast(`Reset ${row.definition.path} in ${scope}`, 'info');
				return;
			}
			if (name === '/' || name === 'f') {
				setSearching(true);
				setQuery('');
				setSelected(0);
				return;
			}
			if (name === 'return' || name === 'enter') {
				const row = rows[selected];
				if (!row) return;
				setEditing({
					label: row.definition.label,
					path: row.definition.path,
					text: row.display === '(unset)' ? '' : row.display,
					definition: row.definition,
				});
			}
		};
		registerHandler?.(handler);
	}, [editing, searching, rows, selected, scope, onClose, registerHandler]);

	const mw = Math.min(100, termWidth - 4);
	const ml = Math.max(0, Math.floor((termWidth - mw) / 2));
	const mh = Math.min(26, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = Math.max(1, mw - 4);
	const listH = Math.max(3, mh - 9);
	const window = getCenteredWindow(rows.length, selected, listH);
	const activeRow = rows[selected];

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
				<box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" backgroundColor={c.bgCard}>
					<text fg={c.accent} attributes={1}>Settings · {tab[0].toUpperCase() + tab.slice(1)}</text>
					<box flexDirection="row" gap={2}>
						<text fg={c.subtext}>scope: {scope} (s)</text>
						<text fg={c.dim}>esc</text>
					</box>
				</box>
				<box height={1} />
				<box height={1} paddingX={2} flexDirection="row" overflow="hidden">
					<text overflow="hidden" wrapMode="none">
						{['appearance', 'model', 'interaction', 'context', 'memory', 'files', 'shell', 'tools', 'tasks', 'providers'].map((id, index) => (
							<span key={id} fg={id === tab ? c.accent : c.dim} attributes={id === tab ? 1 : 0}>
								{index > 0 ? '  ' : ''}{id === 'appearance' ? 'Theme' : id[0].toUpperCase() + id.slice(1)}
							</span>
						))}
					</text>
				</box>
				<box height={1} paddingX={2} flexDirection="row" gap={2}>
					{searching ? (
						<text fg={c.accent}>/{query}█</text>
					) : (
						<text fg={c.dim} overflow="hidden" wrapMode="none" truncate>
							{activeRow ? `${activeRow.definition.section} · ${activeRow.definition.description}` : 'No settings'}
						</text>
					)}
				</box>
				<box height={1} paddingX={2}>
					<text fg={c.border}>{'─'.repeat(innerW)}</text>
				</box>
				<box height={listH} paddingX={2} flexDirection="column" overflow="hidden">
					{rows.length === 0 ? (
						<text fg={c.dim}>No matching settings.</text>
					) : rows.slice(window.start, window.end).map((row, offset) => {
						const index = window.start + offset;
						const isSelected = index === selected;
						const showSection = index === 0 || rows[index - 1].definition.section !== row.definition.section;
						return (
							<box key={row.definition.path} flexDirection="column" overflow="hidden">
								{showSection && query.trim() === '' && (
									<text fg={c.subtext} overflow="hidden" wrapMode="none">{row.definition.section}</text>
								)}
								<text fg={isSelected ? c.accent : c.text} overflow="hidden" wrapMode="none" truncate>
									{isSelected ? '▸ ' : '  '}{row.definition.label}{'  '}
									<span fg={c.subtext}>{row.display}</span>
									<span fg={c.dim}>  [{scopeBadge(row.scope)}]</span>
									{row.changed && <span fg={c.warn}> *</span>}
									{row.definition.restart && <span fg={c.dim}> restart</span>}
								</text>
							</box>
						);
					})}
				</box>
				<box height={1} paddingX={2} flexDirection="row">
					{editing ? (
						<>
							<text fg={c.accent}>{editing.label}: </text>
							<text fg={c.text}>{editing.text}█</text>
							{editing.error && <text fg={c.error}>  {editing.error}</text>}
						</>
					) : (
						<text fg={c.dim} overflow="hidden" wrapMode="none" truncate>
							←→ tab · ↑↓ nav · enter edit · s scope · r reset · / search · esc close
						</text>
					)}
				</box>
				<box paddingX={2} paddingBottom={1} flexDirection="row" justifyContent="flex-end" gap={2}>
					<text fg={c.dim}>{rows.length} setting(s)</text>
				</box>
			</box>
		</box>
	);
}
