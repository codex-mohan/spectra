import type { Component } from '../tui.js';
import { applyBackgroundToLine, visibleWidth } from '../utils.js';

export class Box implements Component {
	private children: Component[] = [];
	private paddingX: number;
	private paddingY: number;
	private bgFn?: (text: string) => string;

	constructor(paddingX: number = 1, paddingY: number = 1, bgFn?: (text: string) => string) {
		this.paddingX = paddingX;
		this.paddingY = paddingY;
		this.bgFn = bgFn;
	}

	addChild(component: Component): void {
		this.children.push(component);
	}
	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) this.children.splice(index, 1);
	}
	clear(): void {
		this.children = [];
	}
	setBgFn(bgFn: (text: string) => string): void {
		this.bgFn = bgFn;
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate?.();
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - this.paddingX * 2);
		const emptyLine = this.bgFn ? applyBackgroundToLine(' '.repeat(width), width, this.bgFn) : ' '.repeat(width);

		const result: string[] = [];
		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);

		for (const child of this.children) {
			for (const line of child.render(innerWidth)) {
				const leftPad = ' '.repeat(this.paddingX);
				const rightPad = ' '.repeat(this.paddingX);
				const padded = leftPad + line + rightPad;
				if (this.bgFn) {
					result.push(applyBackgroundToLine(padded, width, this.bgFn));
				} else {
					const vw = visibleWidth(padded);
					result.push(vw < width ? padded + ' '.repeat(width - vw) : padded);
				}
			}
		}

		for (let i = 0; i < this.paddingY; i++) result.push(emptyLine);
		return result;
	}
}
