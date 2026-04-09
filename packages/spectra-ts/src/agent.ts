import type { ZodType } from "zod";
import { getVersion, createAgent, runAgent, getAgents } from "./native.js";
import type { Model } from "./model.js";

export interface ToolDefinition<TInput = unknown> {
  name: string;
  description: string;
  parameters: TInput;
  schema?: ZodType<TInput>;
}

export function defineTool<TInput>(
  name: string,
  description: string,
  schema: ZodType<TInput>
): ToolDefinition<TInput> {
  return {
    name,
    description,
    parameters: undefined as TInput,
    schema,
  };
}

export interface AgentConfig {
  model: Model;
  systemPrompt?: string;
  tools?: ToolDefinition[];
}

let nativeAgentId: string | null = null;

export class Agent {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  async *prompt(userInput: string): AsyncIterable<StreamEvent> {
    if (!nativeAgentId) {
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
          parameters: {},
        })),
      };

      nativeAgentId = createAgent(JSON.stringify(config));
    }

    const result = runAgent(nativeAgentId, userInput);

    let parsed: { type: string; [key: string]: unknown }[];
    try {
      parsed = JSON.parse(result);
    } catch {
      yield { type: "error", message: "Failed to parse response" };
      return;
    }

    for (const event of parsed) {
      yield event as StreamEvent;
    }
  }

  static tool = defineTool;
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

type StreamEvent =
  | { type: "agent_start" }
  | { type: "turn_start" }
  | { type: "message_start"; message: unknown }
  | { type: "message_update"; delta: unknown }
  | { type: "message_end"; message: unknown }
  | { type: "turn_end"; toolResults: unknown[] }
  | { type: "tool_execution_start"; toolCall: unknown }
  | { type: "tool_execution_update"; partial: unknown }
  | { type: "tool_execution_end"; result: unknown; isError: boolean }
  | { type: "agent_end"; messages: unknown[] }
  | { type: "error"; message: string };
