import type { Component } from '../tui.js';
import { visibleWidth } from '../utils.js';

export class TruncatedText implements Component {
	private text: string;
	private paddingX: number;
	private paddingY: number;
	private cachedLines?: string[];

	constructor(text: string = '', paddingX: number = 0, paddingY: number = 0) {
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
	}

	render(width: number): string[] {
		const contentWidth = Math.max(1, width - this.paddingX * 2);
		const leftPad = ' '.repeat(this.paddingX);
		const rightPad = ' '.repeat(this.paddingX);

		let textLine = leftPad + this.text + rightPad;
		const vw = visibleWidth(textLine);
		if (vw > width) {
			textLine = leftPad + this.text;
			const innerVw = visibleWidth(textLine);
			if (innerVw > width) {
				// Truncate visible content
				let truncated = leftPad;
				let i = 0;
				let w = this.paddingX;
				for (const char of this.text) {
					if (w + 1 > width) break;
					truncated += char;
					w++;
				}
				textLine = truncated + rightPad;
				const finalVw = visibleWidth(textLine);
				if (finalVw < width) textLine += ' '.repeat(width - finalVw);
			} else {
				textLine += ' '.repeat(width - innerVw);
			}
		} else if (vw < width) {
			textLine += ' '.repeat(width - vw);
		}

		const emptyLine = ' '.repeat(width);
		const result: string[] = [];
		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);
		result.push(textLine);
		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);

		return result;
	}
}
