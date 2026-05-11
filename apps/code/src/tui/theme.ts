import type { Theme } from "@singularity-ai/spectra-tui";
import type { AppTheme } from "./types.js";

/**
 * ANSI escape helpers for 256-color and RGB styling.
 * Used to build a rich Catppuccin-inspired palette beyond what the TUI theme provides.
 */
const ansi = {
  fg: (r: number, g: number, b: number) => (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`,
  bg: (r: number, g: number, b: number) => (s: string) => `\x1b[48;2;${r};${g};${b}m${s}\x1b[0m`,
  fgBg: (fr: number, fg: number, fb: number, br: number, bg: number, bb: number) =>
    (s: string) => `\x1b[38;2;${fr};${fg};${fb};48;2;${br};${bg};${bb}m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[22m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
};

/**
 * Catppuccin Mocha palette — extended for the TUI
 */
const cat = {
  rosewater: [245, 224, 220],
  flamingo:  [242, 205, 205],
  pink:      [245, 194, 231],
  mauve:     [203, 166, 247],
  red:       [243, 139, 168],
  maroon:    [235, 160, 172],
  peach:     [250, 179, 135],
  yellow:    [249, 226, 175],
  green:     [166, 227, 161],
  teal:      [148, 226, 213],
  sky:       [137, 220, 235],
  sapphire:  [116, 199, 236],
  blue:      [137, 180, 250],
  lavender:  [180, 190, 254],
  text:      [205, 214, 244],
  subtext1:  [186, 194, 222],
  subtext0:  [166, 173, 200],
  overlay2:  [147, 153, 178],
  overlay1:  [127, 132, 156],
  overlay0:  [108, 112, 134],
  surface2:  [88, 91, 112],
  surface1:  [69, 71, 90],
  surface0:  [49, 50, 68],
  base:      [30, 30, 46],
  mantle:    [24, 24, 37],
  crust:     [17, 17, 27],
} as const;

function rgb(c: readonly [number, number, number]): (s: string) => string {
  return ansi.fg(c[0], c[1], c[2]);
}
function bgRgb(c: readonly [number, number, number]): (s: string) => string {
  return ansi.bg(c[0], c[1], c[2]);
}

export function createAppTheme(t: Theme): AppTheme {
  return {
    // Message borders — softer, more cohesive
    userBorder: rgb(cat.blue),
    userLabel: (s) => ansi.bold(rgb(cat.blue)(s)),
    assistantBorder: rgb(cat.mauve),
    assistantLabel: (s) => ansi.bold(rgb(cat.mauve)(s)),
    toolBorder: rgb(cat.peach),
    toolLabel: (s) => ansi.bold(rgb(cat.peach)(s)),
    toolResultBorder: rgb(cat.surface2),
    toolResultLabel: (s) => rgb(cat.subtext0)(s),
    errorBorder: rgb(cat.red),
    errorLabel: (s) => ansi.bold(rgb(cat.red)(s)),

    // Metrics / status bar
    metricsLine: rgb(cat.surface2),
    metricsSeparator: (s) => rgb(cat.overlay0)(s),
    metricsKey: (s) => rgb(cat.subtext0)(s),
    metricsValue: (s) => rgb(cat.text)(s),
    metricsAccent: (s) => rgb(cat.mauve)(s),

    // Prompt — OpenCode-style bordered input
    promptBorder: rgb(cat.surface1),
    promptSymbol: (s) => rgb(cat.mauve)(s),
    promptHint: (s) => rgb(cat.overlay0)(s),
    promptModelInfo: (s) => rgb(cat.overlay1)(s),
    promptKeybind: (s) => rgb(cat.overlay0)(s),

    // Status bar (oh-my-zsh powerline style)
    statusBg: bgRgb(cat.mantle),
    statusAccent: (s) => rgb(cat.mauve)(s),
    statusDim: (s) => rgb(cat.overlay0)(s),
    statusSuccess: (s) => rgb(cat.green)(s),
    statusWarn: (s) => rgb(cat.yellow)(s),
    statusError: (s) => rgb(cat.red)(s),
    statusTps: (s) => rgb(cat.lavender)(s),

    codeBlock: (s) => rgb(cat.overlay1)(s),
    spinner: t.symbols.spinner,
  };
}

export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function formatCost(costUsd: number): string {
  if (costUsd < 0.01) return `$${costUsd.toFixed(4)}`;
  return `$${costUsd.toFixed(2)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return `${mins}m${secs}s`;
}

export function formatThroughput(tokensPerSec: number): string {
  if (tokensPerSec < 1) return `${tokensPerSec.toFixed(1)} tok/s`;
  return `${Math.round(tokensPerSec)} tok/s`;
}

export function contextPercent(used: number, total: number): string {
  if (total <= 0) return "";
  const pct = Math.round((used / total) * 100);
  if (pct > 90) return `${formatTokenCount(used)}/${formatTokenCount(total)} (${pct}%)`;
  return `${formatTokenCount(used)}/${formatTokenCount(total)}`;
}