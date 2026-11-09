import { c } from '../tokens.js';
import { hasNerdFont } from '../utils/nerd-font.js';
import {
	SETTINGS,
	SETTINGS_TABS,
	effectiveSettingValue,
	findSettingScope,
	formatSettingValue,
	isSettingChanged,
	parseSettingValue,
	validateSettingValue,
	writeSetting,
	type SettingDefinition,
	type SettingScope,
	type SettingsTab,
} from '../../config/registry.js';

export interface SettingRow {
	definition: SettingDefinition;
	value: unknown;
	display: string;
	scope: SettingScope | 'default';
	changed: boolean;
}

export type SettingsLayoutMode = 'sidebar' | 'tabs';

export interface SettingsTabMeta {
	id: SettingsTab;
	label: string;
	glyph: string;
	fallback: string;
	color: string;
}

export const SETTINGS_TAB_META: readonly SettingsTabMeta[] = [
	{ id: 'appearance', label: 'Theme', glyph: '\u{f03d8}', fallback: '◈', color: c.pink },
	{ id: 'model', label: 'Model', glyph: '\u{f061a}', fallback: '◉', color: c.accent },
	{ id: 'interaction', label: 'Interaction', glyph: '\u{f033e}', fallback: '◇', color: c.warn },
	{ id: 'context', label: 'Context', glyph: '\u{f05da}', fallback: '▤', color: c.info },
	{ id: 'memory', label: 'Memory', glyph: '\u{f01bc}', fallback: '▥', color: c.purple },
	{ id: 'files', label: 'Files', glyph: '\u{f024b}', fallback: '▸', color: c.blue },
	{ id: 'shell', label: 'Shell', glyph: '\u{f018d}', fallback: '>', color: c.execTool },
	{ id: 'tools', label: 'Tools', glyph: '\u{f05b7}', fallback: '⚒', color: c.tool },
	{ id: 'tasks', label: 'Tasks', glyph: '\u{f0756}', fallback: '☑', color: c.yellow },
	{ id: 'providers', label: 'Providers', glyph: '\u{f06a5}', fallback: '⬢', color: c.success },
];

export function tabMeta(tab: SettingsTab): SettingsTabMeta {
	return SETTINGS_TAB_META.find((entry) => entry.id === tab) ?? SETTINGS_TAB_META[0];
}

export function tabGlyph(meta: SettingsTabMeta): string {
	return hasNerdFont() ? meta.glyph : meta.fallback;
}

/** Sidebar needs room for the rail; short/wide terminals get top tabs instead. */
export function resolveSettingsLayout(
	width: number,
	height: number,
	preference: 'auto' | 'sidebar' | 'tabs' = 'auto',
): SettingsLayoutMode {
	if (preference === 'tabs') return 'tabs';
	if (preference === 'sidebar') return width >= 88 ? 'sidebar' : 'tabs';
	if (width >= 96 && height >= 22) return 'sidebar';
	if (width >= 88 && height >= 20) return 'sidebar';
	return 'tabs';
}

/** Visible tab window for the top strip, keeping the active tab on screen. */
export function tabStripRange(
	labels: readonly string[],
	activeIndex: number,
	width: number,
	showLabels: boolean,
): { start: number; end: number; hasLeft: boolean; hasRight: boolean } {
	const itemWidth = (index: number) => {
		const label = labels[index] ?? '';
		return showLabels || index === activeIndex ? Math.max(2, label.length + 3) : 4;
	};
	const available = Math.max(8, width - 6);
	let start = activeIndex;
	let used = itemWidth(activeIndex);
	start = activeIndex;
	while (start > 0 && used + itemWidth(start - 1) <= available) {
		start--;
		used += itemWidth(start);
	}
	let end = activeIndex + 1;
	while (end < labels.length && used + itemWidth(end) <= available) {
		used += itemWidth(end);
		end++;
	}
	return { start, end, hasLeft: start > 0, hasRight: end < labels.length };
}

export function tabIndex(tab: SettingsTab): number {
	return SETTINGS_TABS.findIndex((entry) => entry.id === tab);
}

export function nextTab(tab: SettingsTab, delta: number): SettingsTab {
	const index = tabIndex(tab);
	const count = SETTINGS_TABS.length;
	const next = ((index + delta) % count + count) % count;
	return SETTINGS_TABS[next].id;
}

/** Subsequence match; every query character must appear in order. */
export function fuzzyMatch(query: string, text: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	const haystack = text.toLowerCase();
	let cursor = 0;
	for (const character of needle) {
		const found = haystack.indexOf(character, cursor);
		if (found === -1) return false;
		cursor = found + 1;
	}
	return true;
}

export function filterSettings(query: string, tab: SettingsTab): SettingDefinition[] {
	const trimmed = query.trim();
	if (!trimmed) return SETTINGS.filter((entry) => entry.tab === tab);
	return SETTINGS.filter((entry) => fuzzyMatch(trimmed, [
		entry.path,
		entry.label,
		entry.description,
		entry.section,
		SETTINGS_TABS.find((candidate) => candidate.id === entry.tab)?.label ?? '',
	].join(' ')));
}

export function buildSettingRows(definitions: readonly SettingDefinition[], cwd: string = process.cwd()): SettingRow[] {
	return definitions.map((definition) => {
		const value = effectiveSettingValue(definition.path, cwd);
		const scope = findSettingScope(definition.path, cwd);
		return {
			definition,
			value,
			display: definition.secret && value !== undefined ? '••••' : formatSettingValue(value),
			scope,
			changed: isSettingChanged(definition, value),
		};
	});
}

export function scopeBadge(scope: SettingScope | 'default'): string {
	if (scope === 'project') return 'P';
	if (scope === 'global') return 'G';
	return '·';
}

export function toggleScope(scope: SettingScope): SettingScope {
	return scope === 'project' ? 'global' : 'project';
}

export function prepareSetting(
	definition: SettingDefinition,
	raw: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
	let value: unknown;
	try {
		value = parseSettingValue(definition, raw);
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
	const invalid = validateSettingValue(definition, value);
	if (invalid) return { ok: false, error: `${definition.label}: ${invalid}` };
	return { ok: true, value };
}

export function commitSetting(
	definition: SettingDefinition,
	raw: string,
	scope: SettingScope,
	cwd: string = process.cwd(),
): { ok: true; value: unknown } | { ok: false; error: string } {
	const prepared = prepareSetting(definition, raw);
	if (!prepared.ok) return prepared;
	writeSetting(scope, definition.path, prepared.value, cwd);
	return prepared;
}

export function resetSetting(definition: SettingDefinition, scope: SettingScope, cwd: string = process.cwd()): void {
	writeSetting(scope, definition.path, undefined, cwd);
}
