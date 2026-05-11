import { Text } from "./text.js";
import type { TUI } from "../tui.js";
import type { Focusable } from "../tui.js";
import type { Theme } from "../theme.js";

export interface CancellableLoaderOptions {
  message?: string;
  theme?: Theme;
  onCancel?: () => void;
}

export class CancellableLoader extends Text implements Focusable {
  focused = false;
  private frames = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
  private currentFrame = 0;
  private intervalId: NodeJS.Timeout | null = null;
  private tui: TUI;
  private spinnerColorFn: (s: string) => string;
  private messageColorFn: (s: string) => string;
  private currentMessage: string;
  private _onCancel?: () => void;

  constructor(tui: TUI, options?: CancellableLoaderOptions) {
    const theme = options?.theme;
    const spinnerColorFn = theme?.colors.primary ?? ((s: string) => `\x1b[36m${s}\x1b[0m`);
    const messageColorFn = theme?.colors.secondary ?? ((s: string) => `\x1b[37m${s}\x1b[0m`);
    super("", 1, 0);
    this.tui = tui;
    this.spinnerColorFn = spinnerColorFn;
    this.messageColorFn = messageColorFn;
    this.currentMessage = options?.message ?? "Loading...";
    this._onCancel = options?.onCancel;
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

  handleInput(data: string): void {
    if (data === "\x1b" || data === "q" || data === "\x03") {
      this._onCancel?.();
    }
  }

  private updateDisplay(): void {
    const frame = this.frames[this.currentFrame];
    const cancelHint = this.focused ? this.messageColorFn(" (ESC to cancel)") : "";
    this.setText(`${this.spinnerColorFn(frame)} ${this.messageColorFn(this.currentMessage)}${cancelHint}`);
    this.tui.requestRender();
  }
}