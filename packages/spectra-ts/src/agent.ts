import type { Model } from "./model.js";
import type { ToolDefinition } from "./tool.js";
import type { StreamEvent } from "./stream.js";
import { defineTool } from "./tool.js";

export interface AgentConfig {
  model: Model;
  systemPrompt?: string;
  tools?: ToolDefinition[];
}

export class Agent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async *prompt(userInput: string): AsyncIterable<StreamEvent> {
    // TODO: Implement native binding
    // This will call into the .node addon
    yield { type: "agent_start" };
    yield { type: "error", message: "Not implemented: native binding pending" };
  }

  static tool = defineTool;
}

export function createAgent(config: AgentConfig): Agent {
  return new Agent(config);
}
