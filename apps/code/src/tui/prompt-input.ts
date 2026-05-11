import type { Component, Focusable } from "@singularity-ai/spectra-tui";
import { CURSOR_MARKER } from "@singularity-ai/spectra-tui";
import { visibleWidth, wrapTextWithAnsi } from "@singularity-ai/spectra-tui";
import type { AppTheme, SessionMetrics } from "./types.js";
import { formatTokenCount } from "./theme.js";

/**
 * OpenCode-style prompt input with a seamless left vertical bar border.
 *
 * Layout (from screenshots):
 *
 *   │ Ask anything ... "Fix broken tests"
 *   │ Build · claude-sonnet-4-20250514 · anthropic
 *                     107.9K (41%) · $0.18  ctrl+p commands
 *
 * The left bar is a single vertical line — no top, bottom, or right borders.
 * Model info sits below the input inside the bar region.
 * Stats + keybinds sit below, outside the bar.
 */

const VERTICAL = "\u2502";

export class PromptInput implements Component, Focusable {
  focused = false;
  private value = "";
  private cursor = 0;
  private theme: AppTheme;
  private undoStack: { value: string; cursor: number }[] = [];
  private killRing: string[] = [];
  private pasteBuffer = "";
  private isInPaste = false;
  private modelName = "";
  private provider = "";
  private metrics: SessionMetrics | null = null;
  public onSubmit?: (value: string) => void;
  public onEscape?: () => void;
  public onArrowUp?: () => void;
  public onArrowDown?: () => void;
  private maxLines: number;

  constructor(theme: AppTheme, maxLines: number = 6) {
    this.theme = theme;
    this.maxLines = maxLines;
  }

  setModelInfo(modelName: string, provider: string): void {
    this.modelName = modelName;
    this.provider = provider;
  }

  setMetrics(metrics: SessionMetrics): void {
    this.metrics = metrics;
  }

  getValue(): string {
    return this.value;
  }

  setValue(value: string): void {
    this.value = value;
    this.cursor = Math.min(this.cursor, value.length);
    this.invalidate();
  }

  clear(): void {
    this.value = "";
    this.cursor = 0;
    this.undoStack = [];
    this.invalidate();
  }

  invalidate(): void {
    // Will be called by TUI render cycle
  }

  handleInput(data: string): void {
    if (data.includes("\x1b[200~")) {
      this.isInPaste = true;
      this.pasteBuffer = "";
      data = data.replace("\x1b[200~", "");
    }
    if (this.isInPaste) {
      this.pasteBuffer += data;
      const endIndex = this.pasteBuffer.indexOf("\x1b[201~");
      if (endIndex !== -1) {
        const content = this.pasteBuffer.substring(0, endIndex);
        this.handlePaste(content);
        this.isInPaste = false;
        const remaining = this.pasteBuffer.substring(endIndex + 6);
        this.pasteBuffer = "";
        if (remaining) this.handleInput(remaining);
      }
      return;
    }

    if (data === "\r" || data === "\n") {
      this.onSubmit?.(this.value);
      return;
    }

    if (data === "\x1b") {
      this.onEscape?.();
      return;
    }

    if (data === "\x1b[A") {
      this.onArrowUp?.();
      return;
    }

    if (data === "\x1b[B") {
      this.onArrowDown?.();
      return;
    }

    if (data === "\x7f" || data === "\x08") {
      if (this.cursor > 0) {
        this.saveUndo();
        const segments = Array.from(this.value);
        segments.splice(this.cursor - 1, 1);
        this.value = segments.join("");
        this.cursor--;
      }
      return;
    }

    if (data === "\x1b[3~") {
      if (this.cursor < this.value.length) {
        this.saveUndo();
        const segments = Array.from(this.value);
        segments.splice(this.cursor, 1);
        this.value = segments.join("");
      }
      return;
    }

    if (data === "\x1b[D") { this.cursor = Math.max(0, this.cursor - 1); return; }
    if (data === "\x1b[C") { this.cursor = Math.min(this.value.length, this.cursor + 1); return; }

    if (data === "\x1b[H" || data === "\x1b[1~" || data === "\x01") { this.cursor = 0; return; }
    if (data === "\x1b[F" || data === "\x1b[4~" || data === "\x05") { this.cursor = this.value.length; return; }

    if (data === "\x1b[1;5D" || data === "\x1bb") {
      const before = this.value.slice(0, this.cursor);
      const match = before.match(/(.*?)(\S+|\s+)$/);
      this.cursor = match ? Math.max(0, this.cursor - match[2].length) : 0;
      return;
    }
    if (data === "\x1b[1;5C" || data === "\x1bf") {
      const after = this.value.slice(this.cursor);
      const match = after.match(/^(\s+|\S+)/);
      this.cursor += match ? match[0].length : 0;
      return;
    }

    if (data === "\x0b") {
      if (this.cursor < this.value.length) {
        this.killRing.push(this.value.slice(this.cursor));
        if (this.killRing.length > 10) this.killRing.shift();
        this.saveUndo();
        this.value = this.value.slice(0, this.cursor);
      }
      return;
    }
    if (data === "\x15") {
      if (this.cursor > 0) {
        this.killRing.push(this.value.slice(0, this.cursor));
        if (this.killRing.length > 10) this.killRing.shift();
        this.saveUndo();
        this.value = this.value.slice(this.cursor);
        this.cursor = 0;
      }
      return;
    }

    if (data === "\x19") {
      if (this.killRing.length > 0) {
        const yanked = this.killRing[this.killRing.length - 1];
        this.saveUndo();
        this.value = this.value.slice(0, this.cursor) + yanked + this.value.slice(this.cursor);
        this.cursor += yanked.length;
      }
      return;
    }

    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.saveUndo();
      this.insertText(data);
    }
  }

  private handlePaste(content: string): void {
    this.saveUndo();
    this.insertText(content);
  }

  private insertText(text: string): void {
    this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
    this.cursor += text.length;
  }

  private saveUndo(): void {
    this.undoStack.push({ value: this.value, cursor: this.cursor });
    if (this.undoStack.length > 100) this.undoStack.shift();
  }

  /**
   * Renders the prompt area with seamless left-bar style:
   *
   *   │ Ask anything ... "Fix broken tests"
   *   │ Build · claude-sonnet-4-20250514 · anthropic
   *                     107.9K (41%) · $0.18  ctrl+p commands
   */
  render(width: number): string[] {
    if (width <= 0) return [];
    const theme = this.theme;
    const barContentWidth = Math.max(1, width - 4); // │ + space + content + space padding

    // ── Input line with left bar ──
    let displayValue: string;
    if (!this.value && !this.focused) {
      displayValue = theme.promptHint('Ask anything ... "Fix broken tests"');
    } else if (!this.value && this.focused) {
      displayValue = CURSOR_MARKER + "\x1b[7m \x1b[27m" + theme.promptHint(" Ask anything ...");
    } else if (this.focused) {
      const before = this.value.slice(0, this.cursor);
      const at = this.value[this.cursor] ?? " ";
      const after = this.value.slice(this.cursor + 1);
      displayValue = before + CURSOR_MARKER + `\x1b[7m${at}\x1b[27m` + after;
    } else {
      displayValue = this.value;
    }

    const inputWrapped = wrapTextWithAnsi(displayValue, barContentWidth);
    const barLines: string[] = [];
    for (const line of inputWrapped) {
      const vw = visibleWidth(line);
      const padded = line + " ".repeat(Math.max(0, width - 4 - vw));
      barLines.push(theme.promptBorder(VERTICAL) + " " + padded);
    }

    // ── Model info line (inside bar) ──
    const modelDisplay = this.modelName || "...";
    const providerDisplay = this.provider || "";
    const modelInfo = theme.promptModelInfo(`Build \u00B7 ${modelDisplay} `) + theme.promptHint(providerDisplay);
    const modelVw = visibleWidth(modelInfo);
    const modelPadded = modelInfo + " ".repeat(Math.max(0, width - 4 - modelVw));
    barLines.push(theme.promptBorder(VERTICAL) + " " + modelPadded);

    // ── Stats + keybinds line (outside the bar, right-aligned) ──
    const statsLine = this.buildStatsLine(width);

    const result = [...barLines, statsLine];
    return result;
  }

  /**
   * Build the stats line matching OpenCode:
   *   107.9K (41%) · $0.18  ctrl+p commands
   */
  private buildStatsLine(width: number): string {
    const theme = this.theme;
    const parts: string[] = [];

    if (this.metrics) {
      const m = this.metrics;
      const totalTokens = m.inputTokens + m.outputTokens;

      if (totalTokens > 0 || m.tokensUsed > 0) {
        const tokenDisplay = formatTokenCount(totalTokens > 0 ? totalTokens : m.tokensUsed);

        if (m.tokensTotal > 0) {
          const pct = Math.round(((totalTokens > 0 ? totalTokens : m.tokensUsed) / m.tokensTotal) * 100);
          parts.push(theme.metricsValue(`${tokenDisplay} (${pct}%)`));
        } else {
          parts.push(theme.metricsValue(tokenDisplay));
        }
      }

      if (m.costUsd > 0) {
        if (parts.length > 0) parts.push(theme.metricsSeparator(" \u00B7 "));
        parts.push(theme.metricsValue(`$${m.costUsd < 0.01 ? m.costUsd.toFixed(4) : m.costUsd.toFixed(2)}`));
      }
    }

    // Keybinds always shown
    if (parts.length > 0) parts.push("  ");
    parts.push(theme.promptKeybind("ctrl+p"));
    parts.push(theme.promptHint(" commands"));

    const statsContent = parts.join("");
    const statsVw = visibleWidth(statsContent);
    return " ".repeat(Math.max(0, width - statsVw)) + statsContent;
  }
}