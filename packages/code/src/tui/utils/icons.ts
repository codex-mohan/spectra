import { c } from '../tokens.js';
import { hasNerdFont } from './nerd-font.js';

export interface IconSpec {
	/** Nerd Font Material Design glyph, the same family the file badges use. */
	nerd?: string;
	/** Plain-default emoji fallback when Nerd Font coverage is unavailable. */
	emoji: string;
	/** Flat palette color; Nerd glyphs are never rendered in emoji colors. */
	color: string;
}

/** Icon per builtin command id. */
const ICON_BY_ID: Record<string, IconSpec> = {
	new: { nerd: '\u{f0415}', emoji: '➕', color: c.success }, // md-plus
	sessions: { nerd: '\u{f0279}', emoji: '🗂', color: c.subtext }, // md-format_list_bulleted
	'delete-session': { nerd: '\u{f0a79}', emoji: '🗑', color: c.error }, // md-trash_can
	'rename-session': { nerd: '\u{f03eb}', emoji: '✏', color: c.warn }, // md-pencil
	'fork-session': { nerd: '\u{f04c1}', emoji: '🔀', color: c.blue }, // md-source_fork
	'archive-session': { nerd: '\u{f003c}', emoji: '📦', color: c.subtext }, // md-archive
	clear: { nerd: '\u{f00e2}', emoji: '🧹', color: c.warn }, // md-broom
	todo: { nerd: '\u{f0132}', emoji: '☑', color: c.accent }, // md-checkbox_marked
	search: { nerd: '\u{f0349}', emoji: '🔍', color: c.info }, // md-magnify
	export: { nerd: '\u{f01da}', emoji: '💾', color: c.subtext }, // md-download
	history: { nerd: '\u{f02da}', emoji: '🕘', color: c.subtext }, // md-history
	compress: { nerd: '\u{f084d}', emoji: '📉', color: c.warn }, // md-arrow_collapse_vertical
	provider: { nerd: '\u{f06a5}', emoji: '🔌', color: c.accent }, // md-power_plug
	'manage-providers': { nerd: '\u{f0493}', emoji: '⚙', color: c.subtext }, // md-cog
	'switch-model': { nerd: '\u{f061a}', emoji: '🧠', color: c.accent }, // md-chip
	'switch-agent': { nerd: '\u{f06a9}', emoji: '🤖', color: c.blue }, // md-robot
	'cycle-effort': { nerd: '\u{f140b}', emoji: '⚡', color: c.warn }, // md-lightning_bolt
	'change-effort': { nerd: '\u{f140b}', emoji: '⚡', color: c.warn }, // md-lightning_bolt
	'toggle-mcp': { nerd: '\u{f0431}', emoji: '🧩', color: c.purple }, // md-puzzle
	'background-tasks': { nerd: '\u{f0756}', emoji: '⚙', color: c.subtext }, // md-format_list_checks
	memory: { nerd: '\u{f01bc}', emoji: '🧠', color: c.purple }, // md-database
	skills: { nerd: '\u{f1844}', emoji: '✨', color: c.accent }, // md-magic_staff
	'toggle-thinking': { nerd: '\u{f0335}', emoji: '💡', color: c.warn }, // md-lightbulb
	'toggle-tools': { nerd: '\u{f0208}', emoji: '👁', color: c.subtext }, // md-eye
	home: { nerd: '\u{f02dc}', emoji: '🏠', color: c.subtext }, // md-home
	'session-stats': { nerd: '\u{f0128}', emoji: '📊', color: c.accent }, // md-chart_bar
	'context-usage': { nerd: '\u{f05da}', emoji: '📚', color: c.info }, // md-book_open_page_variant
	usage: { nerd: '\u{f012a}', emoji: '📈', color: c.success }, // md-chart_line
	commit: { nerd: '\u{f012c}', emoji: '✅', color: c.success }, // md-check
	review: { nerd: '\u{f0349}', emoji: '🔍', color: c.blue }, // md-magnify
	explain: { nerd: '\u{f05da}', emoji: '📖', color: c.info }, // md-book_open_page_variant
	'build-fix': { nerd: '\u{f05b7}', emoji: '🔧', color: c.warn }, // md-wrench
	theme: { nerd: '\u{f03d8}', emoji: '🎨', color: c.pink }, // md-palette
	permissions: { nerd: '\u{f033e}', emoji: '🔒', color: c.warn }, // md-lock
	settings: { nerd: '\u{f0493}', emoji: '⚙', color: c.subtext }, // md-cog
	doctor: { nerd: '\u{f04d9}', emoji: '🩺', color: c.info }, // md-stethoscope
	debug: { nerd: '\u{f00e4}', emoji: '🐞', color: c.warn }, // md-bug
	about: { nerd: '\u{f02fc}', emoji: 'ℹ', color: c.subtext }, // md-information
	help: { nerd: '\u{f02d7}', emoji: '❓', color: c.info }, // md-help_circle
	quit: { nerd: '\u{f0425}', emoji: '🚪', color: c.error }, // md-power
};

/** Icon by command source when no id mapping exists. */
const ICON_BY_SOURCE: Record<string, IconSpec> = {
	skill: { nerd: '\u{f1844}', emoji: '✨', color: c.accent }, // md-magic_staff
	template: { nerd: '\u{f09ee}', emoji: '📄', color: c.subtext }, // md-file_document_outline
	builtin: { nerd: '\u{f018d}', emoji: '⌘', color: c.dim }, // md-console
};

const FALLBACK_ICON = ICON_BY_SOURCE.builtin!;

/** Footer glyphs from the same Material Design family as the file badges. */
const STATUS_GLYPHS = {
	folder: { nerd: '\u{f024b}', plain: '▸' },
	branch: { nerd: '\u{f062c}', plain: '⑂' },
	chevron: { nerd: '\u{f0142}', plain: '›' },
	sessions: { nerd: '\u{f0279}', plain: '◈' },
	agents: { nerd: '\u{f06a9}', plain: '◉' },
	tools: { nerd: '\u{f05b7}', plain: '⚒' },
	lsp: { nerd: '\u{f0349}', plain: '⌕' },
	mcp: { nerd: '\u{f0431}', plain: '⬢' },
} as const;

export type StatusGlyphName = keyof typeof STATUS_GLYPHS;

export function glyphFor(name: StatusGlyphName): string {
	const spec = STATUS_GLYPHS[name];
	return hasNerdFont() ? spec.nerd : spec.plain;
}

/**
 * Resolve a flat command icon from the same Material Design family the file
 * badges use. Falls back to the plain emoji when {@link hasNerdFont} reports no
 * Nerd Font coverage.
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
