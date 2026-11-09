import { useEffect, useMemo, useRef, useState } from 'react';
import { c } from '../theme.js';
import { showToast } from '../components/toast.js';
import { getCenteredWindow } from '../utils/selection-window.js';
import { truncateMenuText } from '../utils/menu-text.js';
import { hasNerdFont } from '../utils/nerd-font.js';
import { SettingsWriter, SETTINGS, watchConfigFiles, type SettingScope, type SettingsTab } from '../../config/registry.js';
import { loadConfig } from '../../services/config.js';
import {
	SETTINGS_TAB_META,
	buildSettingRows,
	commitSetting,
	filterSettings,
	nextTab,
	resolveSettingsLayout,
	scopeBadge,
	tabGlyph,
	tabMeta,
	tabStripRange,
	toggleScope,
	type SettingsTabMeta,
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

type DisplayItem =
	| { type: 'section'; key: string; label: string; color: string }
	| { type: 'row'; key: string; row: ReturnType<typeof buildSettingRows>[number]; index: number };

const TYPE_GLYPHS: Record<string, string> = {
	boolean: '\u{f0132}',
	enum: '\u{f0142}',
	number: '\u{f0128}',
	string: '\u{f03eb}',
	json: '\u{f018d}',
};

const SCOPE_GLYPHS: Record<string, string> = {
	project: '\u{f024b}',
	global: '\u{f02dc}',
	default: '\u{f0493}',
};

function glyph(nerd: string, plain: string): string {
	return hasNerdFont() ? nerd : plain;
}

function scopeColor(scope: SettingScope | 'default'): string {
	if (scope === 'project') return c.accent;
	if (scope === 'global') return c.info;
	return c.dim;
}

function scopeLabel(scope: SettingScope | 'default'): string {
	const name = scope === 'default' ? 'default' : scope;
	return `${glyph(SCOPE_GLYPHS[name] ?? '', '')} ${scope === 'default' ? '·' : scope === 'project' ? 'P' : 'G'}`;
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

	const preference = loadConfig().settingsLayout ?? 'auto';
	const layout = resolveSettingsLayout(termWidth, termHeight, preference);
	const meta = tabMeta(tab);
	const accent = meta.color;
	const definitions = useMemo(() => filterSettings(query, tab), [query, tab]);
	const rows = useMemo(() => buildSettingRows(definitions), [definitions, version]);
	const allRows = useMemo(() => buildSettingRows(SETTINGS), [version]);
	const changedTotal = allRows.filter((row) => row.changed).length;
	const changedTabs = new Set(allRows.filter((row) => row.changed).map((row) => row.definition.tab));

	useEffect(() => {
		if (selected >= rows.length) setSelected(Math.max(0, rows.length - 1));
	}, [rows.length, selected]);

	const displayItems = useMemo<DisplayItem[]>(() => {
		const items: DisplayItem[] = [];
		let previous = '';
		for (let index = 0; index < rows.length; index++) {
			const row = rows[index];
			const sectionLabel = query.trim()
				? `${tabMeta(row.definition.tab).label} · ${row.definition.section}`
				: row.definition.section;
			if (sectionLabel !== previous) {
				previous = sectionLabel;
				items.push({ type: 'section', key: `section-${sectionLabel}-${index}`, label: sectionLabel, color: tabMeta(row.definition.tab).color });
			}
			items.push({ type: 'row', key: row.definition.path, row, index });
		}
		return items;
	}, [rows, query]);

	useEffect(() => {
		const handler = (rawKey: any) => {
			const key = rawKey && typeof rawKey === 'object' ? rawKey as { name?: string; ctrl?: boolean; meta?: boolean; shift?: boolean } : {};
			const name = key.name ?? '';

			if (editing) {
				if (name === 'escape') { setEditing(null); return; }
				if (name === 'return' || name === 'enter') {
					const result = commitSetting(editing.definition, editing.text, scope);
					if (!result.ok) { setEditing({ ...editing, error: result.error }); return; }
					setEditing(null);
					setVersion((value) => value + 1);
					showToast(`Saved ${editing.path} (${scope})`, 'success');
					return;
				}
				if (name === 'backspace') { setEditing({ ...editing, text: editing.text.slice(0, -1), error: undefined }); return; }
				if (name === 'space' && !key.ctrl && !key.meta) { setEditing({ ...editing, text: `${editing.text} `, error: undefined }); return; }
				if (name.length === 1 && !key.ctrl && !key.meta) { setEditing({ ...editing, text: editing.text + name, error: undefined }); }
				return;
			}

			if (searching) {
				if (name === 'escape') { setSearching(false); setQuery(''); setSelected(0); return; }
				if (name === 'return' || name === 'enter') {
					const row = rows[selected];
					if (row) setEditing({ label: row.definition.label, path: row.definition.path, text: row.display === '(unset)' ? '' : row.display, definition: row.definition });
					return;
				}
				if (name === 'up' && selected > 0) { setSelected(selected - 1); return; }
				if (name === 'down' && selected < rows.length - 1) { setSelected(selected + 1); return; }
				if (name === 'backspace') { setQuery((value) => value.slice(0, -1)); setSelected(0); return; }
				if (name === 'space') { setQuery((value) => `${value} `); setSelected(0); return; }
				if (name.length === 1 && !key.ctrl && !key.meta) { setQuery((value) => value + name); setSelected(0); }
				return;
			}

			if (name === 'escape') { onClose(); return; }
			if (name === 'tab' || name === 'right') {
				setTab((current) => nextTab(current, key.shift ? -1 : 1)); setQuery(''); setSelected(0); return;
			}
			if (name === 'left') { setTab((current) => nextTab(current, -1)); setQuery(''); setSelected(0); return; }
			if (name === 'up' && selected > 0) { setSelected(selected - 1); return; }
			if (name === 'down' && selected < rows.length - 1) { setSelected(selected + 1); return; }
			if (name === 's') { setScope((current) => toggleScope(current)); return; }
			if (name === 'r') {
				const row = rows[selected];
				if (!row) return;
				writer.current.reset(scope, row.definition.path);
				void writer.current.flush();
				setVersion((value) => value + 1);
				showToast(`Reset ${row.definition.path} in ${scope}`, 'info');
				return;
			}
			if (name === '/' || name === 'f') { setSearching(true); setQuery(''); setSelected(0); return; }
			if (name === 'return' || name === 'enter') {
				const row = rows[selected];
				if (!row) return;
				setEditing({ label: row.definition.label, path: row.definition.path, text: row.display === '(unset)' ? '' : row.display, definition: row.definition });
			}
		};
		registerHandler?.(handler);
	}, [editing, searching, rows, selected, scope, onClose, registerHandler]);

	const mw = Math.min(layout === 'sidebar' ? 100 : 92, termWidth - 4);
	const ml = Math.max(0, Math.floor((termWidth - mw) / 2));
	const mh = Math.min(28, termHeight - 2);
	const mt = Math.max(0, Math.floor((termHeight - mh) / 3));
	const innerW = Math.max(1, mw - 4);
	const contentWidth = Math.max(8, layout === 'sidebar' ? mw - 29 : mw - 6);
	const editorHeight = editing ? 4 : 0;
	const chrome = 2 + (layout === 'tabs' ? 2 : 0) + 3 + editorHeight;
	const listHeight = Math.max(3, mh - chrome - 2);
	const selectedDisplay = displayItems.findIndex((item) => item.type === 'row' && item.index === selected);
	const window = getCenteredWindow(displayItems.length, selectedDisplay < 0 ? 0 : selectedDisplay, listHeight);
	const activeRow = rows[selected];
	const labelWidth = Math.max(14, Math.min(30, Math.floor(contentWidth * 0.38)));
	const valueWidth = Math.max(8, contentWidth - labelWidth - 17);

	const scopePill = (
		<text fg={scopeColor(scope)}>{scopeLabel(scope)}</text>
	);
	const tabs = SETTINGS_TAB_META;
	const activeIndex = tabs.findIndex((entry) => entry.id === tab);
	const strip = tabStripRange(tabs.map((entry) => entry.label), activeIndex, Math.max(8, mw - 10), mw >= 72);

	const renderRow = (item: DisplayItem) => {
		if (item.type === 'section') {
			const ruleWidth = Math.max(0, contentWidth - item.label.length - 5);
			return (
				<box key={item.key} height={1} overflow="hidden">
					<text fg={item.color} wrapMode="none" overflow="hidden">
						{item.label}
						<span fg={c.border}> {'─'.repeat(ruleWidth)}</span>
					</text>
				</box>
			);
		}
		const { row, index: rowIndex } = item;
		const selectedRow = rowIndex === selected;
		const definition = row.definition;
		const typeGlyph = glyph(TYPE_GLYPHS[definition.type] ?? '', '');
		const label = truncateMenuText(definition.label, labelWidth).padEnd(labelWidth);
		const value = truncateMenuText(row.display, valueWidth).padEnd(valueWidth);
		const rowColor = selectedRow ? accent : c.text;
		return (
			<box key={item.key} height={1} backgroundColor={selectedRow ? c.bgSelect : c.bgCard} overflow="hidden">
				<text width={contentWidth} height={1} wrapMode="none" overflow="hidden">
					<span fg={selectedRow ? accent : c.dim}>{selectedRow ? '▸ ' : '  '}</span>
					<span fg={selectedRow ? accent : c.dim}>{typeGlyph} </span>
					<span fg={rowColor}>{label}</span>
					<span fg={selectedRow ? c.text : c.subtext}>{value}</span>
					<span fg={scopeColor(row.scope)}> {scopeLabel(row.scope)}</span>
					{row.changed ? <span fg={c.warn}> ●</span> : null}
					{definition.restart ? <span fg={c.warn}> ↻ restart</span> : null}
				</text>
			</box>
		);
	};

	return (
		<box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
			<box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard} border borderColor={c.border} flexDirection="column" overflow="hidden">
				<box height={2} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" flexShrink={0}>
					<box flexDirection="row" gap={1}>
						<text fg={accent} attributes={1}>{glyph('\u{f0493}', '⚙')} Settings</text>
						<text fg={c.dim}>· {meta.label}</text>
					</box>
					<box flexDirection="row" gap={2}>
						{changedTotal > 0 && <text fg={c.warn}>● {changedTotal} changed</text>}
						{scopePill}
						<text fg={c.dim}>esc</text>
					</box>
				</box>

				{layout === 'tabs' && (
					<box height={2} paddingX={2} flexDirection="row" gap={0} flexShrink={0} overflow="hidden">
						{strip.hasLeft && <text fg={c.dim} width={2}>‹</text>}
						{tabs.slice(strip.start, strip.end).map((entry) => {
							const active = entry.id === tab;
							return (
								<box key={entry.id} flexDirection="column" height={2} flexShrink={0}>
									<box height={1} paddingX={1} backgroundColor={active ? c.bgSelect : c.bgCard} flexDirection="row">
										<text fg={active ? entry.color : c.dim}>{tabGlyph(entry)}</text>
										{(mw >= 72 || active) && <text fg={active ? entry.color : c.subtext}> {entry.label}</text>}
									</box>
									<box height={1} backgroundColor={active ? entry.color : c.bgCard} />
								</box>
							);
						})}
						{strip.hasRight && <text fg={c.dim} width={2}>›</text>}
					</box>
				)}

				<box flexGrow={1} flexDirection="row" minHeight={0} overflow="hidden">
					{layout === 'sidebar' && (
						<box width={22} flexDirection="column" flexShrink={0} border={['right']} borderColor={c.border} overflow="hidden">
							{tabs.map((entry) => {
								const active = entry.id === tab;
								const changed = changedTabs.has(entry.id);
								return (
									<box key={entry.id} height={1} flexDirection="row" backgroundColor={active ? c.bgSelect : c.bgCard} overflow="hidden">
										<box width={2} backgroundColor={active ? entry.color : c.bgCard} flexShrink={0} />
										<text fg={active ? entry.color : c.dim} height={1} wrapMode="none"> {tabGlyph(entry)}</text>
										<text fg={active ? entry.color : c.subtext} height={1} wrapMode="none" overflow="hidden"> {entry.label}</text>
										{changed && <text fg={c.warn} height={1}> ●</text>}
									</box>
								);
							})}
						</box>
					)}

					<box flexGrow={1} flexDirection="column" paddingX={2} minWidth={0} overflow="hidden">
						<box height={1} flexDirection="row" gap={1} flexShrink={0}>
							<text fg={accent}>{tabGlyph(meta)} {meta.label}</text>
							<text fg={c.dim} overflow="hidden" wrapMode="none" truncate>{query ? `search: ${query}` : (activeRow?.definition.description ?? '')}</text>
						</box>
						<box height={1} flexDirection="row" flexShrink={0}>
							{searching ? (
								<text fg={c.info}>{glyph('\u{f0349}', '/')} /{query}▏</text>
							) : (
								<text fg={c.dim}>{glyph('\u{f0349}', '/')} / search · {rows.length} setting{rows.length === 1 ? '' : 's'}</text>
							)}
						</box>
						<box height={1} flexShrink={0}>
							<text fg={c.border}>{'─'.repeat(contentWidth)}</text>
						</box>
						<box flexGrow={1} flexDirection="column" overflow="hidden" minHeight={0}>
							{displayItems.length === 0 ? (
								<text fg={c.dim}>No matching settings.</text>
							) : displayItems.slice(window.start, window.end).map((item) => renderRow(item))}
						</box>
						{editing && (
							<box height={4} flexShrink={0} border borderColor={editing.error ? c.error : accent} paddingX={1} flexDirection="column" overflow="hidden">
								<text fg={editing.error ? c.error : accent}>{glyph('\u{f03eb}', '✎')} Edit · {editing.label}</text>
								<text fg={c.text}>{editing.text}▏</text>
								<text fg={editing.error ? c.error : c.dim} overflow="hidden" wrapMode="none" truncate>
									{editing.error ?? (editing.definition.options?.join(' · ') || editing.definition.description)}
								</text>
							</box>
						)}
					</box>
				</box>

				<box height={1} paddingX={2} flexDirection="row" justifyContent="space-between" flexShrink={0} overflow="hidden">
					<text fg={c.dim} overflow="hidden" wrapMode="none" truncate>
						{mh >= 18
							? `${glyph('↔', '←→')} tabs · ↑↓ nav · ${glyph('⏎', 'enter')} edit · s scope · r reset · / search · esc close`
							: `↑↓ nav · enter edit · s scope · esc close`}
					</text>
					<text fg={c.dim}>{rows.length} shown</text>
				</box>
			</box>
		</box>
	);
}
