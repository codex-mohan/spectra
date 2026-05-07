import { Text } from "./text.js";
import type { TUI } from "../tui.js";

export class Loader extends Text {
  private frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  private currentFrame = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private tui: TUI | null = null;
  private currentMessage = "Loading...";

  constructor(
    tui: TUI,
    private spinnerColorFn: (str: string) => string,
    private messageColorFn: (str: string) => string,
    message: string = "Loading...",
  ) {
    super("", 1, 0);
    this.tui = tui;
    this.currentMessage = message;
    this.updateDisplay();
    this.start();
  }

  render(width: number): string[] {
    return ["", ...super.render(width)];
  }

  start(): void {
    if (this.intervalId) return;
    this.intervalId = setInterval(() => {
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
      this.updateDisplay();
    }, 80);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  setMessage(message: string): void {
    this.currentMessage = message;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const frame = this.frames[this.currentFrame];
    this.setText(`${this.spinnerColorFn(frame)} ${this.messageColorFn(this.currentMessage)}`);
    this.tui?.requestRender();
  }
}
