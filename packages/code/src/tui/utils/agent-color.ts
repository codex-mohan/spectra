import { c } from '../tokens.js';

/** Claude-style named colors and Spectra theme aliases — all backed by `c` tokens. */
export const AGENT_COLOR_NAMES = [
	'red',
	'blue',
	'green',
	'yellow',
	'purple',
	'orange',
	'pink',
	'cyan',
	'accent',
	'primary',
	'info',
	'success',
	'warn',
	'error',
] as const;

export type AgentColorName = (typeof AGENT_COLOR_NAMES)[number];

const NAMED: Record<AgentColorName, string> = {
	red: c.red,
	blue: c.blue,
	green: c.green,
	yellow: c.yellow,
	purple: c.purple,
	orange: c.orange,
	pink: c.pink,
	cyan: c.cyan,
	accent: c.accent,
	primary: c.accent,
	info: c.info,
	success: c.success,
	warn: c.warn,
	error: c.error,
};

/**
 * Resolve agent `color` to a hex string for the prompt-bar left strip (and any other UI).
 * Accepts `#RRGGBB` / `#RGB`, or a name from {@link AGENT_COLOR_NAMES} (theme-backed).
 */
export function resolveAgentAccentColor(color: string | undefined, fallback: string = c.accent): string {
	if (!color?.trim()) return fallback;
	const raw = color.trim();
	if (/^#[0-9a-fA-F]{6}$/.test(raw) || /^#[0-9a-fA-F]{3}$/.test(raw)) return raw;
	const named = NAMED[raw.toLowerCase() as AgentColorName];
	return named ?? fallback;
}

export function isAgentColorName(value: string): value is AgentColorName {
	return (AGENT_COLOR_NAMES as readonly string[]).includes(value.toLowerCase());
}
