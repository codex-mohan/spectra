import { RGBA, SyntaxStyle } from '@opentui/core';

// Spectra Void — deep dark bg with a soft spectral teal accent.
// Comfortable for long sessions; no harsh purples.
export const c = {
	text: '#D5D8E0',
	subtext: '#9CA3B0',
	dim: '#5A6070',
	accent: '#6EC8D0',
	purple: '#7EC8D0',
	success: '#A3D9A0',
	warn: '#E0C8A0',
	error: '#E0A0A8',
	user: '#7AA8F0',
	tool: '#E0B890',
	thinking: '#90C0D8',
	info: '#7EC8D0',

	// Tool-specific colors
	readTool: '#7EC8D0',    // teal — passive read
	execTool: '#A3D9A0',    // green — command execution
	writeTool: '#A3D9A0',   // green — file creation
	editTool: '#E0C8A0',    // amber — file modification

	bg: '#0C0C12',
	bgBar: '#141420',
	bgCard: '#141420',
	bgThink: '#141420',
	bgTool: '#141420',
	bgInput: '#12121A',
	bgOverlay: '#08080ECC',
	bgSelect: '#2E2E50',

	sbThumb: '#2A2A3A',
	sbTrack: '#181822',
	border: '#2A2A3A',

	diffAddBg: '#1B2A1B',
	diffRemoveBg: '#2A1B1B',
	diffContextBg: '#0C0C12',
	diffAddSign: '#A3D9A0',
	diffRemoveSign: '#E0A0A8',
	diffLineNumber: '#5A6070',
	diffLineNumberBg: '#141420',
	diffAddLineNumberBg: '#1B2A1B',
	diffRemoveLineNumberBg: '#2A1B1B',
};

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
