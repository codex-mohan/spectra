/**
 * Shared Spectra color palette.
 *
 * Pure constants — no runtime imports, no OpenTUI dependency.
 * Import this module wherever you need the canonical color tokens:
 * TUI components, HTML callback pages, or any non-OpenTUI context.
 */

export const c = {
	text: '#D5D8E0',
	subtext: '#9CA3B0',
	dim: '#5A6070',
	accent: '#6EC8D0',
	// Named palette — single source for agent colors, UI accents, MD agents
	red: '#E06C75',
	blue: '#7AA8F0',
	green: '#A3D9A0',
	yellow: '#E6D56A',
	purple: '#C4A0E0',
	orange: '#D88A55',
	pink: '#E0A0C0',
	cyan: '#6EC8D0',
	success: '#A3D9A0',
	warn: '#E0C8A0',
	error: '#E0A0A8',
	user: '#7AA8F0',
	tool: '#E0B890',
	thinking: '#90C0D8',
	info: '#7EC8D0',
	// File type colors
	fileText: '#9CA3B0',
	fileImage: '#6EC8D0',
	filePdf: '#7AA8F0',
	fileAudio: '#E0C8A0',
	fileVideo: '#E0A0A8',
	fileDirectory: '#9CA3B0',
	fileArchive: '#C8A0E0',
	fileData: '#A3D9A0',

	// Language file colors — reuse base tokens where natural
	langTypeScript: '#7AA8F0',
	langJavaScript: '#E6D56A',
	langRust: '#D88A55',
	langPython: '#E0C8A0',
	langGo: '#6EC8D0',
	langJson: '#A3D9A0',
	langMarkdown: '#9CA3B0',
	langHtml: '#D88A55',
	langCss: '#7AA8F0',
	langShell: '#A3D9A0',
	langYaml: '#9CA3B0',
	langToml: '#D88A55',

	// Tool-specific colors
	readTool: '#7EC8D0',    // passive cyan — read-only tool
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
} as const;
