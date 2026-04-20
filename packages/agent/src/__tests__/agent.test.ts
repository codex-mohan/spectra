import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../agent.js";
import { defineTool } from "../define-tool.js";
import { z } from "zod";
import type { Model, Message } from "@spectra/ai";

const testModel: Model = { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", api: "anthropic-messages" };

describe("Agent", () => {
  it("should create agent instance", () => {
    const agent = new Agent({
      model: testModel,
      systemPrompt: "You are a helpful assistant.",
    });

    expect(agent).toBeDefined();
  });

  it("should store messages", () => {
    const agent = new Agent({ model: testModel });
    expect(agent.messages).toEqual([]);
  });

  it("should register tools", () => {
    const agent = new Agent({ model: testModel });

    const tool = defineTool({
      name: "get_weather",
      description: "Get the current weather",
      parameters: z.object({
        location: z.string().describe("The location to get weather for"),
      }),
      execute: async (args, context) => {
        return {
          content: [{ type: "text", text: `The weather in ${args.location} is sunny.` }],
        };
      },
    });

    agent.registerTool(tool);
    expect(agent.messages).toEqual([]);
  });

  it("should subscribe and unsubscribe listeners", () => {
    const agent = new Agent({ model: testModel });
    const listener = vi.fn();

    const unsubscribe = agent.subscribe(listener);
    expect(unsubscribe).toBeDefined();

    unsubscribe();
  });

  it("should abort request", () => {
    const agent = new Agent({ model: testModel });
    expect(() => agent.abort()).not.toThrow();
  });

  it("should reset state", () => {
    const agent = new Agent({ model: testModel });
    agent.reset();
    expect(agent.messages).toEqual([]);
    expect(agent.isStreaming).toBe(false);
  });

  it("should return signal", () => {
    const agent = new Agent({ model: testModel });
    const signal = agent.signal;
    expect(signal).toBeUndefined();
  });
});

describe("defineTool", () => {
  it("should create tool with Zod schema", () => {
    const tool = defineTool({
      name: "get_weather",
      description: "Get the current weather",
      parameters: z.object({
        location: z.string().describe("The location"),
      }),
      execute: async (args, context) => ({
        content: [{ type: "text", text: "sunny" }],
      }),
    });

    expect(tool.name).toBe("get_weather");
    expect(tool.description).toBe("Get the current weather");
    expect(tool.parameters).toBeDefined();
  });
});
