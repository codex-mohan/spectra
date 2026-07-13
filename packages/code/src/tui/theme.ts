import { RGBA, SyntaxStyle } from '@opentui/core';
import { c } from './tokens.js';
export { c } from './tokens.js';
export { resolveAgentAccentColor, AGENT_COLOR_NAMES, isAgentColorName } from './utils/agent-color.js';
export type { AgentColorName } from './utils/agent-color.js';

export const mdStyle = SyntaxStyle.fromStyles({
	'markup.heading.1': { fg: RGBA.fromHex(c.accent), bold: true },
	'markup.heading.2': { fg: RGBA.fromHex(c.accent), bold: true },
	'markup.heading.3': { fg: RGBA.fromHex(c.accent), bold: true },
	'markup.heading.4': { fg: RGBA.fromHex(c.accent) },
	'markup.bold': { bold: true },
	'markup.italic': { italic: true },
	'markup.list': { fg: RGBA.fromHex(c.text) },
	'markup.raw': { fg: RGBA.fromHex(c.thinking) },
	'markup.link': { fg: RGBA.fromHex(c.user) },
	'markup.quote': { fg: RGBA.fromHex(c.dim) },
	'markup.table': { fg: RGBA.fromHex(c.text) },
	'markup.table.header': { fg: RGBA.fromHex(c.accent), bold: true },
	source: { fg: RGBA.fromHex(c.text) },
	keyword: { fg: RGBA.fromHex(c.accent) },
	string: { fg: RGBA.fromHex(c.success) },
	comment: { fg: RGBA.fromHex(c.dim), italic: true },
	number: { fg: RGBA.fromHex(c.tool) },
	function: { fg: RGBA.fromHex(c.user) },
	type: { fg: RGBA.fromHex(c.accent) },
	default: { fg: RGBA.fromHex(c.text) },
});

export const mdStyleMuted = SyntaxStyle.fromStyles({
	'markup.heading.1': { fg: RGBA.fromHex(c.dim), bold: true },
	'markup.heading.2': { fg: RGBA.fromHex(c.dim), bold: true },
	'markup.heading.3': { fg: RGBA.fromHex(c.dim), bold: true },
	'markup.heading.4': { fg: RGBA.fromHex(c.dim) },
	'markup.bold': { bold: true },
	'markup.italic': { italic: true },
	'markup.list': { fg: RGBA.fromHex(c.dim) },
	'markup.raw': { fg: RGBA.fromHex(c.dim) },
	'markup.link': { fg: RGBA.fromHex(c.dim) },
	'markup.quote': { fg: RGBA.fromHex(c.dim) },
	'markup.table': { fg: RGBA.fromHex(c.dim) },
	'markup.table.header': { fg: RGBA.fromHex(c.dim), bold: true },
	source: { fg: RGBA.fromHex(c.dim) },
	keyword: { fg: RGBA.fromHex(c.dim) },
	string: { fg: RGBA.fromHex(c.dim) },
	comment: { fg: RGBA.fromHex(c.dim), italic: true },
	number: { fg: RGBA.fromHex(c.dim) },
	function: { fg: RGBA.fromHex(c.dim) },
	type: { fg: RGBA.fromHex(c.dim) },
	default: { fg: RGBA.fromHex(c.dim) },
	code: { fg: RGBA.fromHex(c.dim) },
});

export const SPINNER = [
	'\u280B',
	'\u2819',
	'\u2839',
	'\u2838',
	'\u283C',
	'\u2834',
	'\u2826',
	'\u2827',
	'\u2807',
	'\u280F',
];
