import type { Component } from '../tui.js';
import type { Focusable } from '../tui.js';
import { CURSOR_MARKER } from '../tui.js';
import { type Theme, getTheme } from '../theme.js';
import { type FuzzyItem, fuzzySort } from './fuzzy-filter.js';
import { decodeKittyPrintable } from '../keys.js';
import { visibleWidth, truncateToWidth } from '../utils.js';

export interface CommandPaletteItem extends FuzzyItem {
	id: string;
	label: string;
	shortcut?: string;
	group?: string;
	disabled?: boolean;
}

export interface CommandPaletteOptions {
	items: CommandPaletteItem[];
	placeholder?: string;
	theme?: Theme;
	onSelect?: (item: CommandPaletteItem) => void;
	onEscape?: () => void;
}

export class CommandPalette implements Component, Focusable {
	focused = false;
	private allItems: CommandPaletteItem[];
	private filtered: { item: CommandPaletteItem; score: number; indices: number[] }[] = [];
	private selected = 0;
	private scrollTop = 0;
	private query = '';
	private cursor = 0;
	private placeholder: string;
	private theme: Theme;
	private _onSelect?: (item: CommandPaletteItem) => void;
	private _onEscape?: () => void;

	constructor(options: CommandPaletteOptions) {
		this.allItems = options.items;
		this.placeholder = options.placeholder ?? 'Type a command...';
		this.theme = options.theme ?? getTheme();
		this._onSelect = options.onSelect;
		this._onEscape = options.onEscape;
		this.filtered = this.allItems.map((item) => ({ item, score: 0, indices: [] }));
	}

	setItems(items: CommandPaletteItem[]): void {
		this.allItems = items;
		this.updateFilter();
		this.invalidate();
	}

	getQuery(): string {
		return this.query;
	}

	private updateFilter(): void {
		if (!this.query) {
			this.filtered = this.allItems.map((item) => ({ item, score: 0, indices: [] }));
		} else {
			this.filtered = fuzzySort(this.query, this.allItems);
		}
		this.selected = Math.min(this.selected, Math.max(0, this.filtered.length - 1));
		this.scrollTop = 0;
	}

	handleInput(data: string): void {
		const kitty = decodeKittyPrintable(data);
		if (kitty) {
			this.query = this.query.slice(0, this.cursor) + kitty + this.query.slice(this.cursor);
			this.cursor += kitty.length;
			this.updateFilter();
			this.invalidate();
			return;
		}

		if (data === '\x1b') {
			this._onEscape?.();
			return;
		}

		if (data === '\r' || data === '\n') {
			const entry = this.filtered[this.selected];
			if (entry && !entry.item.disabled) this._onSelect?.(entry.item);
			return;
		}

		if (data === '\x1b[A' || data === '\x1b[F' || data === 'k') {
			this.selected = Math.max(0, this.selected - 1);
			this.clampScroll();
			this.invalidate();
			return;
		}

		if (data === '\x1b[B' || data === '\x1b[H' || data === 'j') {
			this.selected = Math.min(this.filtered.length - 1, this.selected + 1);
			this.clampScroll();
			this.invalidate();
			return;
		}

		if (data === '\x1b[5~') {
			this.selected = Math.max(0, this.selected - 8);
			this.clampScroll();
			this.invalidate();
			return;
		}

		if (data === '\x1b[6~') {
			this.selected = Math.min(this.filtered.length - 1, this.selected + 8);
			this.clampScroll();
			this.invalidate();
			return;
		}

		if (data === '\x7f' || data === '\x08') {
			if (this.cursor > 0) {
				this.query = this.query.slice(0, this.cursor - 1) + this.query.slice(this.cursor);
				this.cursor--;
				this.updateFilter();
				this.invalidate();
			}
			return;
		}

		if (data === '\x1b[D') {
			this.cursor = Math.max(0, this.cursor - 1);
			this.invalidate();
			return;
		}
		if (data === '\x1b[C') {
			this.cursor = Math.min(this.query.length, this.cursor + 1);
			this.invalidate();
			return;
		}

		if (data === '\x01' || data === '\x1b[H') {
			this.cursor = 0;
			this.invalidate();
			return;
		}
		if (data === '\x05' || data === '\x1b[F') {
			this.cursor = this.query.length;
			this.invalidate();
			return;
		}

		if (data.length === 1 && data.charCodeAt(0) >= 32) {
			this.query = this.query.slice(0, this.cursor) + data + this.query.slice(this.cursor);
			this.cursor++;
			this.updateFilter();
			this.invalidate();
		}
	}

	private maxVisible = 8;

	private clampScroll(): void {
		if (this.selected < this.scrollTop) this.scrollTop = this.selected;
		if (this.selected >= this.scrollTop + this.maxVisible) {
			this.scrollTop = this.selected - this.maxVisible + 1;
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) return [];
		const lines: string[] = [];
		const colors = this.theme.colors;
		const border = this.theme.border;
		const spacing = this.theme.spacing;

		const innerWidth = width - 2;
		const cursorMarker = this.focused ? CURSOR_MARKER : '';
		let inputLine =
			colors.primary('\u276F ') +
			(this.query
				? this.query.slice(0, this.cursor) + cursorMarker + this.query.slice(this.cursor)
				: colors.muted(this.placeholder));
		const inputPad = innerWidth - visibleWidth(inputLine);
		if (inputPad > 0) inputLine += ' '.repeat(inputPad);

		lines.push(colors.bgPrimary(' ' + inputLine + ' '));

		const topBorder = colors.muted(border.topLeft + border.horizontal.repeat(innerWidth) + border.topRight);
		lines.push(topBorder);

		const start = this.scrollTop;
		const end = Math.min(start + this.maxVisible, this.filtered.length);

		for (let i = start; i < end; i++) {
			const { item, indices } = this.filtered[i];
			const isSelected = i === this.selected;
			let label = item.label;
			if (indices.length > 0) {
				let highlighted = '';
				let lastIdx = 0;
				for (const idx of indices) {
					if (idx > lastIdx) highlighted += label.slice(lastIdx, idx);
					highlighted += colors.accent(label[idx]);
					lastIdx = idx + 1;
				}
				highlighted += label.slice(lastIdx);
				label = highlighted;
			}

			const prefix = isSelected ? colors.primary(this.theme.symbols.arrowRight + ' ') : '  ';
			let line = prefix + label;
			if (item.shortcut) {
				const shortcutStr = colors.dim(item.shortcut);
				const remaining =
					innerWidth - spacing.listPaddingX * 2 - visibleWidth(line) - visibleWidth(shortcutStr) - 2;
				if (remaining > 0) {
					line += ' '.repeat(remaining) + shortcutStr;
				}
			}
			const lw = visibleWidth(line);
			if (lw < innerWidth) line += ' '.repeat(innerWidth - lw);
			line = ' '.repeat(spacing.listPaddingX) + line + ' '.repeat(spacing.listPaddingX);

			if (isSelected) {
				line = colors.bgPrimary(line);
			}

			lines.push(colors.muted(border.vertical) + line + colors.muted(border.vertical));
		}

		if (this.filtered.length === 0) {
			const noResults =
				' '.repeat(spacing.listPaddingX) +
				colors.dim('No results found') +
				' '.repeat(Math.max(0, innerWidth - 18));
			lines.push(colors.muted(border.vertical) + noResults + colors.muted(border.vertical));
		}

		const bottomBorder = colors.muted(border.bottomLeft + border.horizontal.repeat(innerWidth) + border.bottomRight);
		lines.push(bottomBorder);

		return lines;
	}
}
