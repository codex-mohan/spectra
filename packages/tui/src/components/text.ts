import type { Component } from "../tui.js";
import { applyBackgroundToLine, visibleWidth, wrapTextWithAnsi } from "../utils.js";

export class Text implements Component {
  protected text: string;
  private paddingX: number;
  private paddingY: number;
  private customBgFn?: (text: string) => string;

  private cachedText?: string;
  private cachedWidth?: number;
  private cachedLines?: string[];

  constructor(text: string = "", paddingX: number = 1, paddingY: number = 1, customBgFn?: (text: string) => string) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.customBgFn = customBgFn;
  }

  setText(text: string): void {
    this.text = text;
    this.invalidate();
  }

  setCustomBgFn(customBgFn?: (text: string) => string): void {
    this.customBgFn = customBgFn;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedLines = undefined;
    this.cachedText = undefined;
    this.cachedWidth = undefined;
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedText === this.text && this.cachedWidth === width) {
      return this.cachedLines;
    }

    if (!this.text || this.text.trim() === "") {
      const result: string[] = [];
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result;
      return result;
    }

    const normalizedText = this.text.replace(/\t/g, "   ");
    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const wrappedLines = wrapTextWithAnsi(normalizedText, contentWidth);

    const leftMargin = " ".repeat(this.paddingX);
    const rightMargin = " ".repeat(this.paddingX);
    const contentLines: string[] = [];

    for (const line of wrappedLines) {
      const lineWithMargins = leftMargin + line + rightMargin;
      if (this.customBgFn) {
        contentLines.push(applyBackgroundToLine(lineWithMargins, width, this.customBgFn));
      } else {
        const visibleLen = visibleWidth(lineWithMargins);
        if (visibleLen < width) {
          contentLines.push(lineWithMargins + " ".repeat(width - visibleLen));
        } else {
          contentLines.push(lineWithMargins);
        }
      }
    }

    // Top padding
    const emptyLine = this.customBgFn
      ? applyBackgroundToLine(" ".repeat(width), width, this.customBgFn)
      : " ".repeat(width);
    const result: string[] = [];
    for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);
    result.push(...contentLines);
    for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);

    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = result;
    return result;
  }
}
