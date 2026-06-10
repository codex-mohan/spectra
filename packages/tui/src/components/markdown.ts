import type { Component } from '../tui.js';
import { visibleWidth } from '../utils.js';

export class Markdown implements Component {
	private text: string;
	private paddingX: number;
	private paddingY: number;
	private cachedText?: string;
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(text: string = '', paddingX: number = 1, paddingY: number = 1) {
		this.text = text;
		this.paddingX = paddingX;
		this.paddingY = paddingY;
	}

	setText(text: string): void {
		this.text = text;
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

		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const leftPad = ' '.repeat(this.paddingX);
		const rightPad = ' '.repeat(this.paddingX);
		const emptyLine = ' '.repeat(width);

		// Simple markdown rendering: split into paragraphs, wrap each
		const paragraphs = this.text.split('\n\n');
		const result: string[] = [];

		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);

		for (const para of paragraphs) {
			const trimmed = para.trim();
			if (!trimmed) continue;

			// Code blocks
			if (trimmed.startsWith('```')) {
				const codeLines = trimmed.split('\n');
				const content = codeLines.slice(1, -1);
				for (const line of content) {
					const padded = leftPad + '  ' + (line || ' ') + rightPad;
					const vw = visibleWidth(padded);
					result.push(vw < width ? padded + ' '.repeat(width - vw) : padded);
				}
				result.push(emptyLine);
				continue;
			}

			// Headers
			if (trimmed.startsWith('# ')) {
				const headerText = trimmed.replace(/^#+\s*/, '');
				const padded = leftPad + headerText + rightPad;
				const vw = visibleWidth(padded);
				result.push(vw < width ? padded + ' '.repeat(width - vw) : padded);
				result.push(emptyLine);
				continue;
			}

			// Regular text — simple word wrap
			const words = trimmed.split(/\s+/);
			let currentLine = leftPad;
			for (const word of words) {
				const candidate = currentLine + (currentLine === leftPad ? '' : ' ') + word;
				if (visibleWidth(candidate + rightPad) > width) {
					const vw = visibleWidth(currentLine + rightPad);
					result.push(vw < width ? currentLine + rightPad + ' '.repeat(width - vw) : currentLine + rightPad);
					currentLine = leftPad + word;
				} else {
					currentLine = candidate;
				}
			}
			if (currentLine !== leftPad) {
				const vw = visibleWidth(currentLine + rightPad);
				result.push(vw < width ? currentLine + rightPad + ' '.repeat(width - vw) : currentLine + rightPad);
			}
			result.push(emptyLine);
		}

		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);

		this.cachedText = this.text;
		this.cachedWidth = width;
		this.cachedLines = result;
		return result;
	}
}
