import { createAgent, runAgentStream, deleteAgent, getAgents, getVersion } from "./native.js";
import type { Model } from "./model.js";
import type { ContentDelta, StreamEvent } from "./stream.js";
import { SpectraError } from "./errors.js";

export type { ContentDelta, StreamEvent };

export interface ToolDefinition {
  name: string;
  description: string;
  schema?: unknown;
}

export interface AgentConfig {
  model: Model;
  systemPrompt?: string;
  tools?: ToolDefinition[];
}

export class Agent {
  private nativeAgentId: string | null = null;
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  private getOrCreateAgentId(): string {
    if (this.nativeAgentId) return this.nativeAgentId;

    const config = {
      model: {
        provider: this.config.model.provider,
        id: this.config.model.id,
        max_tokens: this.config.model.maxTokens,
        temperature: this.config.model.temperature,
      },
      system_prompt: this.config.systemPrompt,
      tools: this.config.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.schema ?? {},
      })),
    };

    const result = createAgent(JSON.stringify(config));

    let agentId: string;

    try {
      const parsed = JSON.parse(result);
      if (parsed.error) {
        throw new SpectraError("spectra::agent::create", `Failed to create agent: ${parsed.error}`);
      }
      agentId = parsed.agent_id ?? result;
    } catch (e) {
      if (e instanceof SpectraError) throw e;
      if (result && !result.startsWith("{")) {
        agentId = result;
      } else {
        throw new SpectraError("spectra::agent::create", `Failed to create agent: ${result}`);
      }
    }

    this.nativeAgentId = agentId;
    return agentId;
  }

  async *prompt(userInput: string): AsyncIterable<StreamEvent> {
    const agentId = this.getOrCreateAgentId();
    const { stream, status } = runAgentStream(agentId, userInput);

    const statusParsed = JSON.parse(status);
    if (statusParsed.error || statusParsed.status === "error") {
      const msg = statusParsed.error ?? statusParsed.message ?? "Unknown error";
      yield { type: "error", message: msg };
      return;
    }

    for await (const eventJson of stream) {
      try {
        const event = JSON.parse(eventJson) as StreamEvent;
        yield event;
      } catch {
        yield { type: "error", message: `Failed to parse event: ${eventJson}` };
      }
    }
  }

  destroy() {
    if (this.nativeAgentId) {
      deleteAgent(this.nativeAgentId);
      this.nativeAgentId = null;
    }
  }
}

export function createAgentFactory(config: AgentConfig): Agent {
  return new Agent(config);
}

export async function getNativeVersion(): Promise<string> {
  return getVersion();
}

export async function listAgents(): Promise<string[]> {
  return getAgents();
}
