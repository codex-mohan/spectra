import type { Component } from "../tui.js";
import type { Focusable } from "../tui.js";
import { type Theme, getTheme } from "../theme.js";
import { visibleWidth } from "../utils.js";

export interface DialogButton {
  label: string;
  action: string;
  primary?: boolean;
}

export interface DialogOptions {
  title: string;
  message: string;
  buttons?: DialogButton[];
  theme?: Theme;
  onButton?: (action: string) => void;
  onEscape?: () => void;
}

export class Dialog implements Component, Focusable {
  focused = false;
  private title: string;
  private message: string;
  private buttons: DialogButton[];
  private selectedButton = 0;
  private theme: Theme;
  private _onButton?: (action: string) => void;
  private _onEscape?: () => void;
  private maxWidth = 60;

  constructor(options: DialogOptions) {
    this.title = options.title;
    this.message = options.message;
    this.buttons = options.buttons ?? [{ label: "OK", action: "ok", primary: true }];
    this.theme = options.theme ?? getTheme();
    this._onButton = options.onButton;
    this._onEscape = options.onEscape;
    if (this.buttons.length > 0 && this.buttons.some((b) => b.primary)) {
      this.selectedButton = this.buttons.findIndex((b) => b.primary);
    }
  }

  setTitle(title: string): void {
    this.title = title;
    this.invalidate();
  }

  setMessage(message: string): void {
    this.message = message;
    this.invalidate();
  }

  handleInput(data: string): void {
    if (data === "\x1b") {
      this._onEscape?.();
      return;
    }
    if (data === "\r" || data === "\n") {
      const btn = this.buttons[this.selectedButton];
      if (btn) this._onButton?.(btn.action);
      return;
    }
    if (data === "\x1b[D" || data === "\x1b[1;5D") {
      this.selectedButton = Math.max(0, this.selectedButton - 1);
      this.invalidate();
      return;
    }
    if (data === "\x1b[C" || data === "\x1b[1;5C") {
      this.selectedButton = Math.min(this.buttons.length - 1, this.selectedButton + 1);
      this.invalidate();
      return;
    }
    if (data === "\x1b[A") {
      this.selectedButton = Math.max(0, this.selectedButton - 1);
      this.invalidate();
      return;
    }
    if (data === "\x1b[B") {
      this.selectedButton = Math.min(this.buttons.length - 1, this.selectedButton + 1);
      this.invalidate();
      return;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const lines: string[] = [];
    const colors = this.theme.colors;
    const border = this.theme.border;
    const innerWidth = Math.min(width - 2, this.maxWidth) - 2;
    const dialogWidth = innerWidth + 2;

    const topBorder = colors.muted(border.topLeft + border.horizontal.repeat(innerWidth) + border.topRight);
    lines.push(topBorder);

    const titleLine = " " + colors.bold(this.title) + " ".repeat(Math.max(0, innerWidth - 1 - visibleWidth(colors.bold(this.title))));
    lines.push(colors.muted(border.vertical) + titleLine + colors.muted(border.vertical));

    const separatorLine = colors.muted(border.leftTee + border.horizontal.repeat(innerWidth) + border.rightTee);
    lines.push(separatorLine);

    const messageLines = this.wrapMessage(this.message, innerWidth - 2);
    for (const line of messageLines) {
      let padded = " " + line;
      const remaining = innerWidth - visibleWidth(padded);
      if (remaining > 0) padded += " ".repeat(remaining);
      lines.push(colors.muted(border.vertical) + padded + colors.muted(border.vertical));
    }

    lines.push(colors.muted(border.vertical) + " ".repeat(innerWidth) + colors.muted(border.vertical));

    if (this.buttons.length > 0) {
      const buttonsLine = this.renderButtons(innerWidth);
      lines.push(colors.muted(border.vertical) + buttonsLine + colors.muted(border.vertical));
    }

    const bottomBorder = colors.muted(border.bottomLeft + border.horizontal.repeat(innerWidth) + border.bottomRight);
    lines.push(bottomBorder);

    const padLeft = Math.max(0, Math.floor((width - dialogWidth) / 2));
    if (padLeft > 0) {
      for (let i = 0; i < lines.length; i++) {
        lines[i] = " ".repeat(padLeft) + lines[i];
      }
    }

    return lines;
  }

  private renderButtons(innerWidth: number): string {
    const colors = this.theme.colors;
    let buttonsStr = " ";
    for (let i = 0; i < this.buttons.length; i++) {
      const btn = this.buttons[i];
      const isSelected = i === this.selectedButton;
      const label = isSelected
        ? colors.inverse(` ${btn.label} `)
        : ` ${btn.label} `;
      buttonsStr += label + " ";
    }
    const remaining = innerWidth - visibleWidth(buttonsStr);
    if (remaining > 0) buttonsStr += " ".repeat(remaining);
    return buttonsStr;
  }

  private wrapMessage(message: string, maxWidth: number): string[] {
    const rawLines = message.split("\n");
    const result: string[] = [];
    for (const line of rawLines) {
      if (visibleWidth(line) <= maxWidth) {
        result.push(line);
      } else {
        const words = line.split(/\s+/);
        let current = "";
        for (const word of words) {
          const candidate = current ? current + " " + word : word;
          if (visibleWidth(candidate) > maxWidth && current) {
            result.push(current);
            current = word;
          } else {
            current = candidate;
          }
        }
        if (current) result.push(current);
      }
    }
    return result;
  }
}