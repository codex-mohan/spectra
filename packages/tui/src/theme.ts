export interface ThemeColors {
  primary: (s: string) => string;
  secondary: (s: string) => string;
  muted: (s: string) => string;
  accent: (s: string) => string;
  error: (s: string) => string;
  warning: (s: string) => string;
  success: (s: string) => string;
  info: (s: string) => string;
  dim: (s: string) => string;
  bold: (s: string) => string;
  italic: (s: string) => string;
  underline: (s: string) => string;
  strikethrough: (s: string) => string;
  inverse: (s: string) => string;
  bg: (s: string) => string;
  bgPrimary: (s: string) => string;
  bgSecondary: (s: string) => string;
  bgAccent: (s: string) => string;
  bgError: (s: string) => string;
}

export interface ThemeBorder {
  horizontal: string;
  vertical: string;
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  leftTee: string;
  rightTee: string;
  topTee: string;
  bottomTee: string;
  cross: string;
}

export interface ThemeSymbols {
  bullet: string;
  check: string;
  cross: string;
  arrowRight: string;
  arrowDown: string;
  ellipsis: string;
  spinner: string[];
  separator: string;
  branch: string;
  cursorBlock: string;
  cursorBar: string;
}

export interface ThemeSpacing {
  promptPaddingX: number;
  promptPaddingY: number;
  listPaddingX: number;
  listPaddingY: number;
  dialogPaddingX: number;
  dialogPaddingY: number;
  scrollBarWidth: number;
}

export interface Theme {
  colors: ThemeColors;
  border: ThemeBorder;
  symbols: ThemeSymbols;
  spacing: ThemeSpacing;
}

const ansi = {
  fg: (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`,
  bg: (code: number) => (s: string) => `\x1b[${code}m${s}\x1b[0m`,
  fgRgb: (r: number, g: number, b: number) => (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`,
  bgRgb: (r: number, g: number, b: number) => (s: string) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[0m`,
};

export const darkTheme: Theme = {
  colors: {
    primary: ansi.fgRgb(137, 180, 250),
    secondary: ansi.fgRgb(166, 173, 200),
    muted: ansi.fgRgb(108, 112, 134),
    accent: ansi.fgRgb(203, 166, 247),
    error: ansi.fgRgb(243, 139, 168),
    warning: ansi.fgRgb(249, 226, 175),
    success: ansi.fgRgb(166, 227, 161),
    info: ansi.fgRgb(137, 180, 250),
    dim: ansi.fg(2),
    bold: ansi.fg(1),
    italic: ansi.fg(3),
    underline: ansi.fg(4),
    strikethrough: ansi.fg(9),
    inverse: ansi.fg(7),
    bg: ansi.bgRgb(30, 30, 46),
    bgPrimary: ansi.bgRgb(49, 50, 68),
    bgSecondary: ansi.bgRgb(24, 24, 37),
    bgAccent: ansi.bgRgb(88, 91, 112),
    bgError: ansi.bgRgb(52, 28, 36),
  },
  border: {
    horizontal: "\u2500",
    vertical: "\u2502",
    topLeft: "\u250C",
    topRight: "\u2510",
    bottomLeft: "\u2514",
    bottomRight: "\u2518",
    leftTee: "\u251C",
    rightTee: "\u2524",
    topTee: "\u252C",
    bottomTee: "\u2534",
    cross: "\u253C",
  },
  symbols: {
    bullet: "\u2022",
    check: "\u2713",
    cross: "\u2717",
    arrowRight: "\u276F",
    arrowDown: "\u2193",
    ellipsis: "\u2026",
    spinner: ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"],
    separator: "\u2500",
    branch: "\u251C\u2500",
    cursorBlock: "\u2588",
    cursorBar: "\u2502",
  },
  spacing: {
    promptPaddingX: 2,
    promptPaddingY: 0,
    listPaddingX: 2,
    listPaddingY: 0,
    dialogPaddingX: 2,
    dialogPaddingY: 1,
    scrollBarWidth: 1,
  },
};

export const lightTheme: Theme = {
  colors: {
    primary: ansi.fgRgb(30, 72, 170),
    secondary: ansi.fgRgb(88, 91, 112),
    muted: ansi.fgRgb(145, 147, 158),
    accent: ansi.fgRgb(120, 60, 180),
    error: ansi.fgRgb(200, 40, 60),
    warning: ansi.fgRgb(180, 120, 0),
    success: ansi.fgRgb(40, 130, 60),
    info: ansi.fgRgb(30, 72, 170),
    dim: ansi.fg(2),
    bold: ansi.fg(1),
    italic: ansi.fg(3),
    underline: ansi.fg(4),
    strikethrough: ansi.fg(9),
    inverse: ansi.fg(7),
    bg: ansi.bgRgb(250, 250, 252),
    bgPrimary: ansi.bgRgb(240, 241, 245),
    bgSecondary: ansi.bgRgb(255, 255, 255),
    bgAccent: ansi.bgRgb(220, 220, 230),
    bgError: ansi.bgRgb(255, 235, 238),
  },
  border: darkTheme.border,
  symbols: darkTheme.symbols,
  spacing: darkTheme.spacing,
};

let currentTheme: Theme = darkTheme;

export function getTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  currentTheme = theme;
}

export function createTheme(overrides: Partial<Theme>): Theme {
  return {
    colors: { ...darkTheme.colors, ...overrides.colors },
    border: { ...darkTheme.border, ...overrides.border },
    symbols: { ...darkTheme.symbols, ...overrides.symbols },
    spacing: { ...darkTheme.spacing, ...overrides.spacing },
  };
}