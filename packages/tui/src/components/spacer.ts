import type { Component } from "../tui.js";

export class Spacer implements Component {
  private lines: number;

  constructor(lines: number = 1) {
    this.lines = lines;
  }

  invalidate(): void {}

  render(width: number): string[] {
    return Array(this.lines).fill(" ".repeat(width));
  }
}
