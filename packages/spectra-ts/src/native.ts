type NativeModule = {
  getVersion(): string;
  createAgent(configJson: string): string;
  runAgentWithInput(agentId: string, userInput: string, callback: (event: string) => void): string;
  getAgents(): string;
  deleteAgent(agentId: string): boolean;
};

let native: NativeModule | null = null;
let loadAttempted = false;

function loadNative(): NativeModule {
  if (loadAttempted) return native!;
  loadAttempted = true;

  try {
    native = require("../native/spectra_napi.node") as NativeModule;
  } catch {
    try {
      native = require("../native/spectra_napi") as NativeModule;
    } catch {
      console.warn("[spectra] Native addon not loaded.");
      native = {
        getVersion: () => "0.0.0",
        createAgent: () => JSON.stringify({ error: "native_not_loaded" }),
        runAgentWithInput: (_agentId: string, _userInput: string, callback: (e: string) => void) => {
          callback(JSON.stringify({ type: "error", message: "Native addon not loaded" }));
          return JSON.stringify({ status: "error" });
        },
        getAgents: () => "[]",
        deleteAgent: () => false,
      };
    }
  }

  return native!;
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
