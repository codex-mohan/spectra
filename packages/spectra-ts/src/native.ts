let native: {
  getVersion(): string;
  createAgent(configJson: string): string;
  runAgent(agentId: string, input: string): string;
  getAgents(): string;
} | null = null;

let loadAttempted = false;

function loadNative() {
  if (!loadAttempted) {
    loadAttempted = true;
    try {
      // Try loading the native addon with .node extension (napi-rs convention)
      native = require("../native/spectra_napi.node");
    } catch {
      try {
        // Fallback to .dll on Windows
        native = require("../native/spectra_napi");
      } catch {
        console.warn("Native addon not loaded. LLM calls will return errors.");
        native = {
          getVersion: () => "0.0.0",
          createAgent: () => "stub",
          runAgent: () => '[{"type":"error","message":"Native addon not loaded"}]',
          getAgents: () => "[]",
        };
      }
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

export function runAgent(agentId: string, input: string): string {
  return loadNative().runAgent(agentId, input);
}

export function getAgents(): string[] {
  const result = loadNative().getAgents();
  try {
    return JSON.parse(result);
  } catch {
    return [];
  }
}
