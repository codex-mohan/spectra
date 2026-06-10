import type { Component } from '../tui.js';
import { decodeKittyPrintable } from '../keys.js';
import { CURSOR_MARKER, type Focusable } from '../tui.js';
import { getSegmenter, visibleWidth } from '../utils.js';

const segmenter = getSegmenter();

export class Input implements Component, Focusable {
	private value = '';
	private cursor = 0;
	private undoStack: { value: string; cursor: number }[] = [];
	private killRing: string[] = [];
	private lastAction: 'kill' | 'yank' | 'type' | null = null;
	private pasteBuffer = '';
	private isInPaste = false;
	private cachedWidth?: number;
	private cachedLines?: string[];

	focused = false;
	public onSubmit?: (value: string) => void;
	public onEscape?: () => void;
	public placeholder = '';

	getValue(): string {
		return this.value;
	}

	setValue(value: string): void {
		this.value = value;
		this.cursor = Math.min(this.cursor, value.length);
		this.invalidate();
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
				this.handlePaste(pasteContent);
				this.isInPaste = false;
				const remaining = this.pasteBuffer.substring(endIndex + 6);
				this.pasteBuffer = '';
				if (remaining) this.handleInput(remaining);
			}
			return;
		}

		// Kitty printable
		const printable = decodeKittyPrintable(data);
		if (printable) {
			this.saveUndo();
			this.insertText(printable);
			this.lastAction = 'type';
			return;
		}

		const ch = data.charCodeAt(0);

		// Enter
		if (data === '\r' || data === '\n') {
			this.onSubmit?.(this.value);
			return;
		}

		// Escape
		if (data === '\x1b') {
			this.onEscape?.();
			return;
		}

		// Tab
		if (data === '\t') {
			this.saveUndo();
			this.insertText('  ');
			this.lastAction = 'type';
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
			}
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
			}
			return;
		}

		// Left
		if (data === '\x1b[D') {
			this.cursor = Math.max(0, this.cursor - 1);
			return;
		}
		// Right
		if (data === '\x1b[C') {
			this.cursor = Math.min(this.value.length, this.cursor + 1);
			return;
		}

		// Ctrl+Left word
		if (data === '\x1b[1;5D' || data === '\x1bb') {
			const before = this.value.slice(0, this.cursor);
			const match = before.match(/(.*?)(\S+|\s+)$/);
			if (match) this.cursor = Math.max(0, this.cursor - match[2].length);
			else this.cursor = 0;
			return;
		}
		// Ctrl+Right word
		if (data === '\x1b[1;5C' || data === '\x1bf') {
			const after = this.value.slice(this.cursor);
			const match = after.match(/^(\s+|\S+)/);
			if (match) this.cursor += match[0].length;
			else this.cursor = this.value.length;
			return;
		}

		// Home/End
		if (data === '\x1b[H' || data === '\x1b[1~' || data === '\x01') {
			this.cursor = 0;
			return;
		}
		if (data === '\x1b[F' || data === '\x1b[4~' || data === '\x05') {
			this.cursor = this.value.length;
			return;
		}

		// Ctrl+K
		if (data === '\x0b') {
			if (this.cursor < this.value.length) {
				this.killRing.push(this.value.slice(this.cursor));
				if (this.killRing.length > 10) this.killRing.shift();
				this.saveUndo();
				this.value = this.value.slice(0, this.cursor);
				this.lastAction = 'kill';
			}
			return;
		}

		// Ctrl+U
		if (data === '\x15') {
			if (this.cursor > 0) {
				this.killRing.push(this.value.slice(0, this.cursor));
				if (this.killRing.length > 10) this.killRing.shift();
				this.saveUndo();
				this.value = this.value.slice(this.cursor);
				this.cursor = 0;
				this.lastAction = 'kill';
			}
			return;
		}

		// Ctrl+W
		if (data === '\x17') {
			if (this.cursor > 0) {
				const before = this.value.slice(0, this.cursor);
				const match = before.match(/(\s*\S+\s*)$/);
				if (match && match[1]) {
					this.killRing.push(match[1]);
					if (this.killRing.length > 10) this.killRing.shift();
					this.saveUndo();
					this.value = before.slice(0, before.length - match[1].length) + this.value.slice(this.cursor);
					this.cursor -= match[1].length;
					this.lastAction = 'kill';
				}
			}
			return;
		}

		// Ctrl+Y yank
		if (data === '\x19') {
			if (this.killRing.length > 0) {
				const yanked = this.killRing[this.killRing.length - 1];
				this.saveUndo();
				this.value = this.value.slice(0, this.cursor) + yanked + this.value.slice(this.cursor);
				this.cursor += yanked.length;
				this.lastAction = 'yank';
			}
			return;
		}

		// Printable ASCII
		if (ch >= 32 && ch <= 126) {
			this.saveUndo();
			this.insertText(data);
			this.lastAction = 'type';
			return;
		}
	}

	private handlePaste(content: string): void {
		this.saveUndo();
		this.insertText(content);
		this.lastAction = 'yank';
	}

	private insertText(text: string): void {
		this.value = this.value.slice(0, this.cursor) + text + this.value.slice(this.cursor);
		this.cursor += text.length;
	}

	private saveUndo(): void {
		this.undoStack.push({ value: this.value, cursor: this.cursor });
		if (this.undoStack.length > 100) this.undoStack.shift();
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (width <= 0) return [];

		const cursorLine = this.value || this.placeholder || '';
		let displayLine = cursorLine;
		if (cursorLine) {
			const before = Array.from(cursorLine.slice(0, Math.min(this.cursor, this.value.length))).join('');
			const at = this.value[this.cursor] ?? '';
			const after = Array.from(this.value.slice(this.cursor + 1)).join('');

			const marker = this.focused ? CURSOR_MARKER : '';
			const cursorChar = this.focused ? `\x1b[7m${at || ' '}\x1b[27m` : at;
			displayLine = before + marker + cursorChar + after;
		}

		const visibleLen = visibleWidth(displayLine);
		const result = visibleLen < width ? displayLine + ' '.repeat(width - visibleLen) : displayLine;
		return [result.slice(0, width + 30)]; // allow marker padding
	}
}
