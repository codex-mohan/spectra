import type { Component } from "../tui.js";
import { type Theme, getTheme } from "../theme.js";
import { visibleWidth, truncateToWidth } from "../utils.js";

export interface ScrollBoxOptions {
  scrollbar?: boolean;
  scrollToBottomOnAppend?: boolean;
  theme?: Theme;
}

export class ScrollBox implements Component {
  private lines: string[] = [];
  private scrollTop = 0;
  private focused = false;
  private scrollbar: boolean;
  private scrollToBottomOnAppend: boolean;
  private theme: Theme;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(options?: ScrollBoxOptions) {
    this.scrollbar = options?.scrollbar ?? true;
    this.scrollToBottomOnAppend = options?.scrollToBottomOnAppend ?? true;
    this.theme = options?.theme ?? getTheme();
  }

  get lineCount(): number {
    return this.lines.length;
  }

  get scrollPosition(): number {
    return this.scrollTop;
  }

  setContent(lines: string[]): void {
    this.lines = lines;
    this.clampScroll();
    this.invalidate();
  }

  appendLines(lines: string[]): void {
    this.lines.push(...lines);
    if (this.scrollToBottomOnAppend) {
      this.scrollTop = Math.max(0, this.lines.length - 1);
    } else {
      this.clampScroll();
    }
    this.invalidate();
  }

  appendLine(line: string): void {
    this.lines.push(line);
    if (this.scrollToBottomOnAppend) {
      this.scrollTop = Math.max(0, this.lines.length - 1);
    } else {
      this.clampScroll();
    }
    this.invalidate();
  }

  clear(): void {
    this.lines = [];
    this.scrollTop = 0;
    this.invalidate();
  }

  scrollUp(by: number = 1): void {
    this.scrollTop = Math.max(0, this.scrollTop - by);
    this.invalidate();
  }

  scrollDown(by: number = 1): void {
    this.scrollTop = Math.min(Math.max(0, this.lines.length - 1), this.scrollTop + by);
    this.invalidate();
  }

  scrollTo(pos: number): void {
    this.scrollTop = Math.max(0, Math.min(this.lines.length - 1, pos));
    this.invalidate();
  }

  scrollToBottom(): void {
    this.scrollTop = Math.max(0, this.lines.length - 1);
    this.invalidate();
  }

  handleInput(data: string): void {
    if (data === "\x1b[A" || data === "\x1b[1;5A") {
      this.scrollUp(data === "\x1b[1;5A" ? 5 : 1);
      return;
    }
    if (data === "\x1b[B" || data === "\x1b[1;5B") {
      this.scrollDown(data === "\x1b[1;5B" ? 5 : 1);
      return;
    }
    if (data === "\x1b[H" || data === "\x1b[1~" || data === "\x01") {
      this.scrollTo(0);
      return;
    }
    if (data === "\x1b[F" || data === "\x1b[4~" || data === "\x05") {
      this.scrollToBottom();
      return;
    }
    if (data === "\x1b[5~") {
      this.scrollUp(10);
      return;
    }
    if (data === "\x1b[6~") {
      this.scrollDown(10);
      return;
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  render(width: number): string[] {
    if (width <= 0) return [];
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;

    const height = this.visibleHeight;
    if (height <= 0) {
      this.cachedWidth = width;
      this.cachedLines = [];
      return [];
    }

    this.clampScroll();
    const result: string[] = [];
    const scrollBarWidth = this.scrollbar && this.lines.length > height ? 1 : 0;
    const contentWidth = Math.max(1, width - scrollBarWidth);

    for (let i = 0; i < height; i++) {
      const lineIndex = this.scrollTop + i;
      if (lineIndex < this.lines.length) {
        let line = this.lines[lineIndex];
        const vw = visibleWidth(line);
        if (vw > contentWidth) {
          line = truncateToWidth(line, contentWidth, "", false);
        } else if (vw < contentWidth) {
          line += " ".repeat(contentWidth - vw);
        }
        result.push(line);
      } else {
        result.push(" ".repeat(contentWidth));
      }
    }

    if (scrollBarWidth > 0 && this.lines.length > height) {
      const pct = this.scrollTop / Math.max(1, this.lines.length - height);
      const thumbPos = Math.min(height - 1, Math.floor(pct * height));
      const thumbSize = Math.max(1, Math.min(height, Math.round((height / this.lines.length) * height)));

      for (let i = 0; i < result.length; i++) {
        if (i >= thumbPos && i < thumbPos + thumbSize) {
          result[i] = result[i] + this.theme.colors.muted("\u2590");
        } else {
          result[i] = result[i] + this.theme.colors.dim("\u2502");
        }
      }
    }

    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }

  private visibleHeight: number = 0;

  setVisibleHeight(height: number): void {
    this.visibleHeight = height;
    this.clampScroll();
    this.invalidate();
  }

  private clampScroll(): void {
    const height = this.visibleHeight;
    if (height <= 0) return;
    const maxScroll = Math.max(0, this.lines.length - height);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));
  }
}