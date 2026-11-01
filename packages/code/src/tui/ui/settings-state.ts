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
