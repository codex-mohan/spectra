import type { Component } from '../tui.js';
import { visibleWidth, wrapTextWithAnsi } from '../utils.js';
import type { TUI } from '../tui.js';
import { Text } from './text.js';

export interface EditorTheme {
	borderColor: (str: string) => string;
}

export interface EditorOptions {
	paddingX?: number;
}

export class Editor implements Component {
	private tui: TUI;
	private theme: EditorTheme;
	private paddingX: number;
	private value = '';
	private cursor = 0;
	private cacheWidth?: number;
	private cacheLines?: string[];
	private cacheValue?: string;
	private cacheCursor?: number;
	private isFocused = false;

	public onChange?: (value: string) => void;
	public onSubmit?: (value: string) => void;

	// Bracketed paste
	private pasteBuffer = '';
	private isInPaste = false;

	// Undo / kill ring
	private undoStack: { value: string; cursor: number }[] = [];
	private killRing: string[] = [];
	private lastAction: 'kill' | 'type' | null = null;

	constructor(tui: TUI, theme: EditorTheme, options?: EditorOptions) {
		this.tui = tui;
		this.theme = theme;
		this.paddingX = options?.paddingX ?? 0;
	}

	setValue(value: string): void {
		this.value = value;
		this.cursor = Math.min(this.cursor, value.length);
		this.invalidate();
	}

	getValue(): string {
		return this.value;
	}

	setPaddingX(paddingX: number): void {
		this.paddingX = paddingX;
		this.invalidate();
	}

	focus(): void {
		this.tui.setFocus(this);
		this.isFocused = true;
	}

	blur(): void {
		this.isFocused = false;
		this.tui.setFocus(null);
	}

	invalidate(): void {
		this.cacheLines = undefined;
		this.cacheWidth = undefined;
		this.cacheValue = undefined;
		this.cacheCursor = undefined;
	}

	handleInput(data: string): void {
		// Bracketed paste
		if (data.includes('\x1b[200~')) {
			this.isInPaste = true;
			this.pasteBuffer = '';
			data = data.replace('\x1b[200~', '');
		}
		if (this.isInPaste) {
			this.pasteBuffer += data;
			const endIndex = this.pasteBuffer.indexOf('\x1b[201~');
			if (endIndex !== -1) {
				const pasteContent = this.pasteBuffer.substring(0, endIndex);
				this.insertText(pasteContent);
				this.isInPaste = false;
				const remaining = this.pasteBuffer.substring(endIndex + 6);
				this.pasteBuffer = '';
				if (remaining) this.handleInput(remaining);
			}
			return;
		}

		// Special keys
		if (data === '\r' || data === '\n') {
			this.onSubmit?.(this.value);
			return;
		}
		if (data === '\x1b') {
			return; // Escape – no-op, TUI handles quit
		}
		if (data === '\t') {
			this.insertText('  ');
			return;
		}

		// Backspace
		if (data === '\x7f' || data === '\x08') {
			if (this.cursor > 0) {
				this.saveUndo();
				const segments = Array.from(this.value);
				segments.splice(this.cursor - 1, 1);
				this.value = segments.join('');
				this.cursor--;
				this.lastAction = 'type';
				this.onChange?.(this.value);
			}
			this.invalidate();
			return;
		}

		// Delete
		if (data === '\x1b[3~') {
			if (this.cursor < this.value.length) {
				this.saveUndo();
				const segments = Array.from(this.value);
				segments.splice(this.cursor, 1);
				this.value = segments.join('');
				this.lastAction = 'type';
				this.onChange?.(this.value);
			}
			this.invalidate();
			return;
		}

		// Arrow keys
		if (data === '\x1b[D') {
			this.cursor = Math.max(0, this.cursor - 1);
			this.invalidate();
			return;
		}
		if (data === '\x1b[C') {
			this.cursor = Math.min(this.value.length, this.cursor + 1);
			this.invalidate();
			return;
		}

		// Home/End
		if (data === '\x1b[H' || data === '\x1b[1~') {
			this.cursor = 0;
			this.invalidate();
			return;
		}
		if (data === '\x1b[F' || data === '\x1b[4~') {
			this.cursor = this.value.length;
			this.invalidate();
			return;
		}

		// Ctrl+A / Ctrl+E
		if (data === '\x01') {
			this.cursor = 0;
			this.invalidate();
			return;
		}
		if (data === '\x05') {
			this.cursor = this.value.length;
			this.invalidate();
			return;
		}

		// Ctrl+K — kill to end of line
		if (data === '\x0b') {
			if (this.cursor < this.value.length) {
				const killed = this.value.slice(this.cursor);
				this.killRing.push(killed);
				if (this.killRing.length > 10) this.killRing.shift();
				this.saveUndo();
				this.value = this.value.slice(0, this.cursor);
				this.lastAction = 'kill';
				this.onChange?.(this.value);
			}
			this.invalidate();
			return;
		}

		// Ctrl+U — kill to start of line
		if (data === '\x15') {
			if (this.cursor > 0) {
				const killed = this.value.slice(0, this.cursor);
				this.killRing.push(killed);
				if (this.killRing.length > 10) this.killRing.shift();
				this.saveUndo();
				this.value = this.value.slice(this.cursor);
				this.cursor = 0;
				this.lastAction = 'kill';
				this.onChange?.(this.value);
			}
			this.invalidate();
			return;
		}

		// Ctrl+W — kill word backward
		if (data === '\x17') {
			if (this.cursor > 0) {
				const before = this.value.slice(0, this.cursor);
				const match = before.match(/(\s*\S+\s*)$/);
				if (match && match[1]) {
					const killed = match[1];
					this.killRing.push(killed);
					if (this.killRing.length > 10) this.killRing.shift();
					this.saveUndo();
					this.value = this.value.slice(0, this.cursor - killed.length) + this.value.slice(this.cursor);
					this.cursor -= killed.length;
					this.lastAction = 'kill';
					this.onChange?.(this.value);
				}
			}
			this.invalidate();
			return;
		}

		// Ctrl+Y — yank
		if (data === '\x19') {
			if (this.killRing.length > 0) {
				const yanked = this.killRing[this.killRing.length - 1];
				this.saveUndo();
				const before = this.value.slice(0, this.cursor);
				const after = this.value.slice(this.cursor);
				this.value = before + yanked + after;
				this.cursor += yanked.length;
				this.lastAction = 'type';
				this.onChange?.(this.value);
			}
			this.invalidate();
			return;
		}

		// Ctrl+Left / Ctrl+Right — word navigation
		if (data === '\x1b[1;5D' || data === '\x1bb') {
			// Move cursor back by word
			const before = this.value.slice(0, this.cursor);
			const match = before.match(/(.*?)(\S+|\s+)$/);
			if (match) {
				this.cursor = Math.max(0, this.cursor - match[2].length);
			} else {
				this.cursor = 0;
			}
			this.invalidate();
			return;
		}
		if (data === '\x1b[1;5C' || data === '\x1bf') {
			// Move cursor forward by word
			const after = this.value.slice(this.cursor);
			const match = after.match(/^(\s+|\S+)/);
			if (match) {
				this.cursor += match[0].length;
			} else {
				this.cursor = this.value.length;
			}
			this.invalidate();
			return;
		}

		// Printable characters
		if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) <= 126) {
			this.saveUndo();
			this.insertText(data);
			this.lastAction = 'type';
			this.onChange?.(this.value);
			this.invalidate();
			return;
		}

		// Longer printable text (paste chunks)
		if (data.length > 1 && !data.startsWith('\x1b')) {
			this.saveUndo();
			this.insertText(data);
			this.lastAction = 'type';
			this.onChange?.(this.value);
			this.invalidate();
			return;
		}
	}

	private insertText(text: string): void {
		const before = this.value.slice(0, this.cursor);
		const after = this.value.slice(this.cursor);
		this.value = before + text + after;
		this.cursor += text.length;
	}

	private saveUndo(): void {
		this.undoStack.push({ value: this.value, cursor: this.cursor });
		if (this.undoStack.length > 100) this.undoStack.shift();
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const borderColor = this.theme.borderColor;

		// Wrap editor content
		const displayText = this.value + (this.isFocused ? '\x1b[7m \x1b[27m' : '');
		const wrapped = wrapTextWithAnsi(displayText, contentWidth);

		const leftPad = ' '.repeat(this.paddingX);
		const rightPad = ' '.repeat(this.paddingX);

		// Top border
		const result: string[] = [];
		const borderLine = borderColor('\u2500'.repeat(width));
		result.push(borderLine);

		// Content lines
		for (const line of wrapped) {
			const padded = leftPad + line + rightPad;
			const visibleLen = visibleWidth(padded);
			result.push(padded + (visibleLen < width ? ' '.repeat(width - visibleLen) : ''));
		}

		// Bottom border
		result.push(borderLine);

		return result;
	}
}
