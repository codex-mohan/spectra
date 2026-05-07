export interface StdinBufferOptions {
  timeout: number;
}

export interface StdinBufferEventMap {
  data: (sequence: string) => void;
  paste: (content: string) => void;
}

export class StdinBuffer {
  private listeners: { [K in keyof StdinBufferEventMap]?: StdinBufferEventMap[K] } = {};
  private buffer = "";
  private timer: NodeJS.Timeout | null = null;
  private timeout: number;
  private lastFlush = 0;
  private inPaste = false;
  private pasteContent = "";

  constructor(options: StdinBufferOptions) {
    this.timeout = options.timeout;
  }

  on<K extends keyof StdinBufferEventMap>(event: K, listener: StdinBufferEventMap[K]): void {
    this.listeners[event] = listener;
  }

  process(data: string): void {
    // Handle bracketed paste
    if (data.includes("\x1b[200~")) {
      this.inPaste = true;
      this.pasteContent = "";
      const segments = data.split("\x1b[200~");
      this.pasteContent += segments[1] || "";
      if (this.pasteContent.includes("\x1b[201~")) {
        const endIndex = this.pasteContent.indexOf("\x1b[201~");
        const content = this.pasteContent.substring(0, endIndex);
        this.inPaste = false;
        this.listeners.paste?.(content);
        const remaining = this.pasteContent.substring(endIndex + 6);
        if (remaining) this.process(remaining);
        return;
      }
      return;
    }

    if (this.inPaste) {
      this.pasteContent += data;
      if (this.pasteContent.includes("\x1b[201~")) {
        const endIndex = this.pasteContent.indexOf("\x1b[201~");
        const content = this.pasteContent.substring(0, endIndex);
        this.inPaste = false;
        this.listeners.paste?.(content);
        const remaining = this.pasteContent.substring(endIndex + 6);
        if (remaining) this.process(remaining);
      }
      return;
    }

    // Flush timer-based buffering
    this.buffer += data;
    this.lastFlush = Date.now();

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (data.length > 1) {
      this.flushNow();
    } else {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.flushNow();
      }, this.timeout);
    }
  }

  private flushNow(): void {
    if (this.buffer.length === 0) return;
    const sequence = this.buffer;
    this.buffer = "";
    this.listeners.data?.(sequence);
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = "";
    this.inPaste = false;
    this.pasteContent = "";
  }
}
