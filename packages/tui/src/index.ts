// Core TUI
export {
	type Component,
	Container,
	CURSOR_MARKER,
	type Focusable,
	isFocusable,
	type OverlayAnchor,
	type OverlayHandle,
	type OverlayMargin,
	type OverlayOptions,
	type SizeValue,
	TUI,
} from './tui.js';

// Terminal
export { ProcessTerminal, type Terminal } from './terminal.js';

// Keys
export {
	isKeyRelease,
	isKittyProtocolActive,
	Key,
	type KeyId,
	matchesKey,
	parseKey,
	setKittyProtocolActive,
} from './keys.js';

// Stdin buffer
export { StdinBuffer, type StdinBufferEventMap, type StdinBufferOptions } from './stdin-buffer.js';

// Keybindings
export { KeybindingsManager, type Keybinding, type KeybindingHandler } from './keybindings.js';

// Theme
export {
	createTheme,
	darkTheme,
	getTheme,
	lightTheme,
	setTheme,
	type Theme,
	type ThemeBorder,
	type ThemeColors,
	type ThemeSpacing,
	type ThemeSymbols,
} from './theme.js';

// Utilities
export { truncateToWidth, visibleWidth, wrapTextWithAnsi } from './utils.js';

// Components
export { Box } from './components/box.js';
export { CancellableLoader, type CancellableLoaderOptions } from './components/cancellable-loader.js';
export { CommandPalette, type CommandPaletteItem, type CommandPaletteOptions } from './components/command-palette.js';
export { Dialog, type DialogButton, type DialogOptions } from './components/dialog.js';
export { Editor, type EditorOptions, type EditorTheme } from './components/editor.js';
export {
	fuzzyMatch,
	fuzzySort,
	type FuzzyItem,
	type FuzzyResult,
	type FuzzyScoredItem,
} from './components/fuzzy-filter.js';
export { Input } from './components/input.js';
export { Loader } from './components/loader.js';
export { Markdown } from './components/markdown.js';
export { ScrollBox, type ScrollBoxOptions } from './components/scroll-box.js';
export { SelectList, type SelectListItem, type SelectListOptions } from './components/select-list.js';
export { Spacer } from './components/spacer.js';
export { Text } from './components/text.js';
export { TruncatedText } from './components/truncated-text.js';
