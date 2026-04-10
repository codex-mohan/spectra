import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

function getNativeDir(): string {
  const url = import.meta.url;
  const filePath = fileURLToPath(url);
  const fileDir = dirname(filePath);
  const candidate = join(fileDir, "native");
  if (existsSync(join(candidate, "spectra_napi.node"))) {
    return candidate;
  }
  return join(fileDir, "..", "native");
}

function loadNative(): NativeModule {
  if (loadAttempted) return native!;
  loadAttempted = true;

  const nativeDir = getNativeDir();
  const nativePath = join(nativeDir, "spectra_napi.node");

  try {
    native = require(nativePath) as NativeModule;
  } catch (e) {
    nativeFailed = true;
    native = {
      getVersion: () => { throw new Error("Native addon not loaded. Run 'cargo build --release --package spectra-napi' and 'pnpm build' to compile."); },
      createAgent: () => { throw new Error("Native addon not loaded. Run 'cargo build --release --package spectra-napi' and 'pnpm build' to compile."); },
      runAgentWithInput: () => { throw new Error("Native addon not loaded. Run 'cargo build --release --package spectra-napi' and 'pnpm build' to compile."); },
      getAgents: () => { throw new Error("Native addon not loaded. Run 'cargo build --release --package spectra-napi' and 'pnpm build' to compile."); },
      deleteAgent: () => { throw new Error("Native addon not loaded. Run 'cargo build --release --package spectra-napi' and 'pnpm build' to compile."); },
    };
  }

  return native!;
}

type NativeModule = {
  getVersion(): string;
  createAgent(configJson: string): string;
  runAgentWithInput(agentId: string, userInput: string, callback: (event: string) => void): string;
  getAgents(): string;
  deleteAgent(agentId: string): boolean;
};

let native: NativeModule | null = null;
let loadAttempted = false;
let nativeFailed = false;

export function isNativeLoaded(): boolean {
  loadNative();
  return !nativeFailed;
}

export function getVersion(): string {
  return loadNative().getVersion();
}

export function createAgent(configJson: string): string {
  return loadNative().createAgent(configJson);
}

export function runAgentWithInput(
  agentId: string,
  userInput: string,
  callback: (event: string) => void,
): string {
  return loadNative().runAgentWithInput(agentId, userInput, callback);
}

export function getAgents(): string[] {
  try {
    return JSON.parse(loadNative().getAgents());
  } catch {
    return [];
  }
}

export function deleteAgent(agentId: string): boolean {
  return loadNative().deleteAgent(agentId);
}

export class EventStream {
  private events: string[] = [];
  private waiting: Array<(value: string) => void> = [];
  private _done = false;

  push(event: string) {
    if (this._done) return;
    const waiter = this.waiting.shift();
    if (waiter) {
      waiter(event);
    } else {
      this.events.push(event);
    }
  }

  end() {
    this._done = true;
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter("__SPECTRA_STREAM_END__");
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<string> {
    while (true) {
      if (this.events.length > 0) {
        const event = this.events.shift()!;
        if (event === "__SPECTRA_STREAM_END__") return;
        yield event;
      } else if (this._done) {
        return;
      } else {
        const event = await new Promise<string>((resolve) => this.waiting.push(resolve));
        if (event === "__SPECTRA_STREAM_END__") return;
        yield event;
      }
    }
  }
}

export function runAgentStream(
  agentId: string,
  userInput: string,
): { stream: EventStream; status: string } {
  const stream = new EventStream();
  const status = runAgentWithInput(agentId, userInput, (event) => stream.push(event));
  return { stream, status };
}
