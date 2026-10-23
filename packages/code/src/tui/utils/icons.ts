import { c } from '../tokens.js';
import { hasNerdFont } from './file-visuals.js';

export interface IconSpec {
	/** Nerd Font glyph (Font Awesome range). Absent → the emoji is always used. */
	nerd?: string;
	/** Plain-default emoji fallback when Nerd Font coverage is unavailable. */
	emoji: string;
	/** Flat palette color; Nerd glyphs are never rendered in emoji colors. */
	color: string;
}

/** Icon per builtin command id. */
const ICON_BY_ID: Record<string, IconSpec> = {
	new: { nerd: '\uf067', emoji: '➕', color: c.success },
	sessions: { nerd: '\uf03a', emoji: '🗂', color: c.subtext },
	'delete-session': { nerd: '\uf1f8', emoji: '🗑', color: c.error },
	'rename-session': { nerd: '\uf044', emoji: '✏', color: c.warn },
	'fork-session': { nerd: '\uf126', emoji: '🔀', color: c.blue },
	'archive-session': { nerd: '\uf187', emoji: '📦', color: c.subtext },
	clear: { nerd: '\uf00d', emoji: '🧹', color: c.warn },
	todo: { nerd: '\uf046', emoji: '☑', color: c.accent },
	search: { nerd: '\uf002', emoji: '🔍', color: c.info },
	export: { nerd: '\uf019', emoji: '💾', color: c.subtext },
	history: { nerd: '\uf1da', emoji: '🕘', color: c.subtext },
	compress: { nerd: '\uf066', emoji: '📉', color: c.warn },
	provider: { nerd: '\uf0e8', emoji: '🔌', color: c.accent },
	'manage-providers': { nerd: '\uf085', emoji: '⚙', color: c.subtext },
	'switch-model': { nerd: '\uf2db', emoji: '🧠', color: c.accent },
	'switch-agent': { nerd: '\uf544', emoji: '🤖', color: c.blue },
	'cycle-effort': { nerd: '\uf0e7', emoji: '⚡', color: c.warn },
	'change-effort': { nerd: '\uf0e7', emoji: '⚡', color: c.warn },
	'toggle-mcp': { nerd: '\uf12e', emoji: '🧩', color: c.purple },
	'background-tasks': { nerd: '\uf013', emoji: '⚙', color: c.subtext },
	memory: { nerd: '\uf1c0', emoji: '🧠', color: c.purple },
	skills: { nerd: '\uf0d0', emoji: '✨', color: c.accent },
	'toggle-thinking': { nerd: '\uf0eb', emoji: '💡', color: c.warn },
	'toggle-tools': { nerd: '\uf06e', emoji: '👁', color: c.subtext },
	home: { nerd: '\uf015', emoji: '🏠', color: c.subtext },
	'session-stats': { nerd: '\uf080', emoji: '📊', color: c.accent },
	'context-usage': { nerd: '\uf02d', emoji: '📚', color: c.info },
	usage: { nerd: '\uf201', emoji: '📈', color: c.success },
	commit: { nerd: '\uf00c', emoji: '✅', color: c.success },
	review: { nerd: '\uf002', emoji: '🔍', color: c.blue },
	explain: { nerd: '\uf02d', emoji: '📖', color: c.info },
	'build-fix': { nerd: '\uf0ad', emoji: '🔧', color: c.warn },
	theme: { nerd: '\uf1fc', emoji: '🎨', color: c.pink },
	permissions: { nerd: '\uf023', emoji: '🔒', color: c.warn },
	settings: { nerd: '\uf013', emoji: '⚙', color: c.subtext },
	doctor: { nerd: '\uf0f1', emoji: '🩺', color: c.info },
	debug: { nerd: '\uf188', emoji: '🐞', color: c.warn },
	about: { nerd: '\uf05a', emoji: 'ℹ', color: c.subtext },
	help: { nerd: '\uf059', emoji: '❓', color: c.info },
	quit: { nerd: '\uf011', emoji: '🚪', color: c.error },
};

/** Icon by command source when no id mapping exists. */
const ICON_BY_SOURCE: Record<string, IconSpec> = {
	skill: { nerd: '\uf0d0', emoji: '✨', color: c.accent },
	template: { nerd: '\uf15c', emoji: '📄', color: c.subtext },
	builtin: { nerd: '\uf120', emoji: '⌘', color: c.dim },
};

const FALLBACK_ICON = ICON_BY_SOURCE.builtin!;

/**
 * Resolve a flat command icon. Nerd Font glyphs are used while
 * {@link hasNerdFont} reports coverage (`SPECTRA_NERD_FONT` / `NO_NERD_FONT`);
 * otherwise the plain emoji fallback is returned.
 */
export function iconForCommand(
	command: { id: string; source?: string; icon?: string },
): { glyph: string; color: string } {
	const byName = command.icon ? ICON_BY_ID[command.icon] : undefined;
	const bareId = command.id.slice(command.id.lastIndexOf(':') + 1);
	const byId = ICON_BY_ID[bareId];
	const bySource = command.source ? ICON_BY_SOURCE[command.source] : undefined;
	const spec = byName ?? byId ?? bySource ?? FALLBACK_ICON;
	const glyph = hasNerdFont() && spec.nerd ? spec.nerd : spec.emoji;
	return { glyph, color: spec.color };
}
