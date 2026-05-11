import type { Component } from "../tui.js";
import type { Focusable } from "../tui.js";
import { type Theme, getTheme } from "../theme.js";
import { visibleWidth, truncateToWidth } from "../utils.js";

export interface SelectListItem {
  id: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

export interface SelectListOptions {
  items: SelectListItem[];
  theme?: Theme;
  pageSize?: number;
  onSelect?: (item: SelectListItem) => void;
  onEscape?: () => void;
}

export class SelectList implements Component, Focusable {
  focused = false;
  private items: SelectListItem[];
  private selected = 0;
  private scrollTop = 0;
  private pageSize: number;
  private theme: Theme;
  private _onSelect?: (item: SelectListItem) => void;
  private _onEscape?: () => void;
  private filter = "";
  private filteredItems: { item: SelectListItem; originalIndex: number }[] = [];

  constructor(options: SelectListOptions) {
    this.items = options.items;
    this.pageSize = options.pageSize ?? 10;
    this.theme = options.theme ?? getTheme();
    this._onSelect = options.onSelect;
    this._onEscape = options.onEscape;
    this.updateFilter();
  }

  setItems(items: SelectListItem[]): void {
    this.items = items;
    this.selected = 0;
    this.scrollTop = 0;
    this.updateFilter();
    this.invalidate();
  }

  getSelectedItem(): SelectListItem | undefined {
    if (this.filteredItems.length === 0) return undefined;
    return this.filteredItems[this.selected]?.item;
  }

  getSelectedIndex(): number {
    if (this.filteredItems.length === 0) return -1;
    return this.filteredItems[this.selected]?.originalIndex ?? -1;
  }

  private updateFilter(): void {
    if (!this.filter) {
      this.filteredItems = this.items.map((item, i) => ({ item, originalIndex: i }));
    } else {
      const lowerFilter = this.filter.toLowerCase();
      this.filteredItems = this.items
        .map((item, i) => ({ item, originalIndex: i }))
        .filter(({ item }) =>
          item.label.toLowerCase().includes(lowerFilter) ||
          (item.description?.toLowerCase().includes(lowerFilter) ?? false),
        );
    }
    if (this.selected >= this.filteredItems.length) {
      this.selected = Math.max(0, this.filteredItems.length - 1);
    }
    this.clampScroll();
  }

  handleInput(data: string): void {
    if (data === "\x1b[A" || data === "\x1b[F" || data === "k") {
      this.moveUp();
      return;
    }
    if (data === "\x1b[B" || data === "\x1b[H" || data === "j") {
      this.moveDown();
      return;
    }
    if (data === "\x1b[5~") {
      this.moveUp(this.pageSize);
      return;
    }
    if (data === "\x1b[6~") {
      this.moveDown(this.pageSize);
      return;
    }
    if (data === "\r" || data === "\n") {
      const entry = this.filteredItems[this.selected];
      if (entry && !entry.item.disabled) this._onSelect?.(entry.item);
      return;
    }
    if (data === "\x1b") {
      this._onEscape?.();
      return;
    }
    if (data === "\x7f" || data === "\x08") {
      if (this.filter.length > 0) {
        this.filter = this.filter.slice(0, -1);
        this.updateFilter();
      }
      return;
    }
    if (data.length === 1 && data.charCodeAt(0) >= 32) {
      this.filter += data;
      this.updateFilter();
    }
  }

  private moveUp(by: number = 1): void {
    if (this.filteredItems.length === 0) return;
    this.selected = Math.max(0, this.selected - by);
    this.clampScroll();
    this.invalidate();
  }

  private moveDown(by: number = 1): void {
    if (this.filteredItems.length === 0) return;
    this.selected = Math.min(this.filteredItems.length - 1, this.selected + by);
    this.clampScroll();
    this.invalidate();
  }

  private clampScroll(): void {
    const visibleHeight = this.pageSize;
    if (this.selected < this.scrollTop) this.scrollTop = this.selected;
    if (this.selected >= this.scrollTop + visibleHeight) {
      this.scrollTop = this.selected - visibleHeight + 1;
    }
  }

  invalidate(): void {}

  render(width: number): string[] {
    if (width <= 0) return [];
    const lines: string[] = [];
    const visibleHeight = this.pageSize;
    const start = this.scrollTop;
    const end = Math.min(start + visibleHeight, this.filteredItems.length);

    for (let i = start; i < end; i++) {
      const { item } = this.filteredItems[i];
      const isSelected = i === this.selected && this.focused;
      const prefix = isSelected ? `${this.theme.colors.primary(this.theme.symbols.arrowRight)} ` : "  ";
      const label = item.disabled
        ? this.theme.colors.dim(item.label)
        : isSelected
          ? this.theme.colors.primary(item.label)
          : item.label;
      let line = prefix + label;
      if (item.description) {
        const remaining = width - visibleWidth(line) - 3;
        if (remaining > 0) {
          const desc = truncateToWidth(item.description, remaining);
          line += this.theme.colors.dim(` \u2502 ${desc}`);
        }
      }
      const vw = visibleWidth(line);
      if (vw < width) line += " ".repeat(width - vw);
      lines.push(line);
    }

    for (let i = this.filteredItems.length; i < visibleHeight; i++) {
      lines.push(" ".repeat(width));
    }

    return lines;
  }
}