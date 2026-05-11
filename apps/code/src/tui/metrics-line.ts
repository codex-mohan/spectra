import type { Component } from "@singularity-ai/spectra-tui";
import { visibleWidth } from "@singularity-ai/spectra-tui";
import type { SessionMetrics } from "./types.js";
import type { AppTheme } from "./types.js";
import { formatTokenCount, formatDuration, formatThroughput, formatCost } from "./theme.js";

/**
 * Oh-my-zsh / Powerline-inspired status bar.
 *
 * Layout:
 * ├─  ✓ claude-sonnet-4-20250514 ─────────── ↓1.2K ↑340 · 42 tok/s · 2.1s ─┤
 *
 * Segments:
 *   Left:  status icon + model name
 *   Right: ↓input ↑output · tok/s · duration · cost · turn N
 */

const HORIZONTAL = "\u2500";
const LEFT_TEE = "\u251C";
const RIGHT_TEE = "\u2524";

// Powerline-style arrows for oh-my-zsh feel
const ARROW_DOWN = "\u2193";   // ↓ for input/download tokens
const ARROW_UP = "\u2191";     // ↑ for output/upload tokens
const DOT = "\u00B7";          // · separator

export class MetricsLine implements Component {
  private metrics: SessionMetrics;
  private theme: AppTheme;
  private spinnerFrame = 0;
  private spinnerInterval: NodeJS.Timeout | null = null;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(theme: AppTheme, metrics: SessionMetrics) {
    this.theme = theme;
    this.metrics = metrics;
  }

  setMetrics(metrics: Partial<SessionMetrics>): void {
    this.metrics = { ...this.metrics, ...metrics };
    this.invalidate();
  }

  startSpinner(): void {
    if (this.spinnerInterval) return;
    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.theme.spinner.length;
      this.invalidate();
    }, 80);
  }

  stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.invalidate();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const theme = this.theme;
    const m = this.metrics;

    // ── Left segment: status icon + model ──
    const statusIcon = m.status === "idle" ? "\u2713"
      : m.status === "streaming" ? this.theme.spinner[this.spinnerFrame]
      : m.status === "tool_call" ? "\u2699"
      : m.status === "thinking" ? this.theme.spinner[this.spinnerFrame]
      : m.status === "error" ? "\u2717"
      : "\u2713";

    const statusColorFn = m.status === "error" ? theme.statusError
      : m.status === "idle" ? theme.statusSuccess
      : theme.statusWarn;

    const leftContent = statusColorFn(` ${statusIcon} `) + theme.metricsKey(m.modelName);

    // ── Right segment: ↓input ↑output · tok/s · duration · cost ──
    const rightParts: string[] = [];

    // Token counts: ↓input ↑output
    if (m.inputTokens > 0 || m.outputTokens > 0) {
      const inputStr = theme.statusTps(`${ARROW_DOWN}${formatTokenCount(m.inputTokens)}`);
      const outputStr = theme.statusTps(`${ARROW_UP}${formatTokenCount(m.outputTokens)}`);
      rightParts.push(`${inputStr} ${outputStr}`);
    }

    // Cache stats if available
    if (m.cacheReadTokens > 0) {
      rightParts.push(theme.statusDim(`cache ${formatTokenCount(m.cacheReadTokens)}`));
    }

    // Tokens per second (show while streaming or after completion)
    if (m.tokensPerSecond > 0) {
      rightParts.push(theme.statusTps(formatThroughput(m.tokensPerSecond)));
    }

    // Duration
    if (m.durationMs > 0) {
      rightParts.push(theme.statusDim(formatDuration(m.durationMs)));
    }

    // Cost
    if (m.costUsd > 0) {
      rightParts.push(theme.statusAccent(formatCost(m.costUsd)));
    }

    // Turn count
    if (m.turnCount > 0) {
      rightParts.push(theme.statusDim(`turn ${m.turnCount}`));
    }

    const rightContent = rightParts.length > 0
      ? rightParts.join(theme.metricsSeparator(` ${DOT} `))
      : "";

    // ── Assemble the powerline bar ──
    // ├─  ✓ model ──────────────── ↓1.2K ↑340 · 42 tok/s · 2.1s ─┤
    const leftStr = LEFT_TEE + HORIZONTAL + " " + leftContent + " ";
    const rightStr = rightContent ? " " + rightContent + " " + HORIZONTAL : "";

    const leftVw = visibleWidth(leftStr);
    const rightVw = visibleWidth(rightStr);
    const fillWidth = Math.max(0, width - leftVw - rightVw - 1); // -1 for RIGHT_TEE

    let line = leftStr + HORIZONTAL.repeat(fillWidth) + rightStr + RIGHT_TEE;

    // Apply the base metrics color
    line = theme.metricsLine(line);

    this.cachedWidth = width;
    this.cachedLines = [line];
    return this.cachedLines;
  }
}