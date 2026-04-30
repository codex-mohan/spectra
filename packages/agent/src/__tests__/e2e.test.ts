import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../agent.js";
import { defineTool } from "../define-tool.js";
import { z } from "zod";
import type { Model, Message, AssistantMessage, AssistantMessageEvent } from "@spectra/ai";
import { AssistantMessageEventStream, registerProvider } from "@spectra/ai";

// Test model
const testModel: Model = {
  id: "claude-sonnet-4-20250514",
  name: "Claude Sonnet 4",
  provider: "test-provider",
  api: "test",
};

// Helper to create a mock provider that returns specific events
function createMockProvider(name: string, responseSequence: AssistantMessage[][]) {
  let callIndex = 0;
  
  return {
    name,
    stream(model: Model, context: any) {
      const stream = new AssistantMessageEventStream();
      const responses = responseSequence[callIndex] || [];
      callIndex++;
      
      setTimeout(() => {
        const partial: AssistantMessage = {
          role: "assistant",
          content: [],
          provider: model.provider,
          model: model.id,
          usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
          stopReason: "stop",
          timestamp: Date.now(),
        };
        
        stream.push({ type: "start", partial });
        
        // Stream text content
        for (let i = 0; i < responses.length; i++) {
          const msg = responses[i];
          for (const block of msg.content) {
            if (block.type === "text") {
              stream.push({
                type: "text_delta",
                contentIndex: i,
                delta: block.text,
                partial: { ...partial, content: [block] },
              });
            } else if (block.type === "toolCall") {
              stream.push({
                type: "toolcall_start",
                contentIndex: i,
                partial: { ...partial, content: [block] },
              });
              stream.push({
                type: "toolcall_end",
                contentIndex: i,
                toolCall: block,
                partial: { ...partial, content: [block] },
              });
            }
          }
        }
        
        // Use the last response's stop reason
        const lastResponse = responses[responses.length - 1] || partial;
        stream.push({
          type: "done",
          reason: lastResponse.stopReason,
          message: lastResponse,
        });
        stream.end();
      }, 10);
      
      return stream;
    },
  };
}

// Helper to create text-only assistant message
function createTextMessage(text: string, stopReason: "stop" | "toolUse" = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "test-provider",
    model: "test-model",
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
    stopReason,
    timestamp: Date.now(),
  };
}

// Helper to create tool call message
function createToolCallMessage(toolCalls: any[]): AssistantMessage {
  return {
    role: "assistant",
    content: toolCalls,
    provider: "test-provider",
    model: "test-model",
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

describe("Agent E2E - Basic Conversation", () => {
  beforeEach(() => {
    // Clear and re-register mock provider
  });

  it("should run simple conversation without tools", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Hello! How can I help you?")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      systemPrompt: "You are a helpful assistant.",
    });

    const events: any[] = [];
    for await (const event of agent.run("Hi!")) {
      events.push(event);
    }

    // Should have agent_start, message_start, message_end, turn_start, message_start, message_update(s), message_end, turn_end, agent_end
    expect(events.length).toBeGreaterThan(0);
    
    const eventTypes = events.map((e) => e.type);
    expect(eventTypes).toContain("agent_start");
    expect(eventTypes).toContain("agent_end");
    expect(eventTypes).toContain("turn_start");
    expect(eventTypes).toContain("turn_end");
  });

  it("should maintain message history across turns", async () => {
    const responses = [
      [createTextMessage("First response")],
      [createTextMessage("Second response")],
    ];
    const mockProvider = createMockProvider("test-provider", responses);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    // First run
    for await (const _ of agent.run("Message 1")) {
      // consume
    }

    const firstHistoryLength = agent.messages.length;

    // Second run
    for await (const _ of agent.run("Message 2")) {
      // consume
    }

    const secondHistoryLength = agent.messages.length;
    
    // History should accumulate
    expect(secondHistoryLength).toBeGreaterThan(firstHistoryLength);
  });

  it("should emit message events with correct structure", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Test response")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    const events: any[] = [];
    for await (const event of agent.run("Test")) {
      events.push(event);
    }

    const messageStart = events.find((e) => e.type === "message_start");
    const messageEnd = events.find((e) => e.type === "message_end");

    expect(messageStart).toBeDefined();
    expect(messageEnd).toBeDefined();
    expect(messageStart.message.role).toBeDefined();
    expect(messageEnd.message.role).toBeDefined();
  });
});

describe("Agent E2E - Tool Execution", () => {
  it("should execute single tool call", async () => {
    const tool = defineTool({
      name: "get_weather",
      description: "Get weather information",
      parameters: z.object({
        location: z.string().describe("The location"),
      }),
      execute: async (args) => {
        return {
          content: [{ type: "text", text: `Weather in ${args.location}: Sunny` }],
        };
      },
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "get_weather",
            arguments: { location: "NYC" },
          },
        ]),
      ],
      [createTextMessage("The weather in NYC is Sunny")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool],
    });

    const events: any[] = [];
    for await (const event of agent.run("What's the weather?")) {
      events.push(event);
    }

    const toolStart = events.find((e) => e.type === "tool_execution_start");
    const toolEnd = events.find((e) => e.type === "tool_execution_end");

    expect(toolStart).toBeDefined();
    expect(toolEnd).toBeDefined();
    expect(toolStart.toolName).toBe("get_weather");
    expect(toolEnd.result.content[0].text).toBe("Weather in NYC: Sunny");
    expect(toolEnd.isError).toBe(false);
  });

  it("should execute multiple tools in parallel", async () => {
    const tool1 = defineTool({
      name: "get_weather",
      description: "Get weather",
      parameters: z.object({ location: z.string() }),
      execute: async (args) => ({
        content: [{ type: "text", text: `Weather: ${args.location}` }],
      }),
    });

    const tool2 = defineTool({
      name: "get_time",
      description: "Get time",
      parameters: z.object({ timezone: z.string() }),
      execute: async (args) => ({
        content: [{ type: "text", text: `Time: ${args.timezone}` }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "get_weather",
            arguments: { location: "NYC" },
          },
          {
            type: "toolCall",
            id: "call_2",
            name: "get_time",
            arguments: { timezone: "EST" },
          },
        ]),
      ],
      [createTextMessage("Done")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool1, tool2],
      toolExecution: "parallel",
    });

    const events: any[] = [];
    for await (const event of agent.run("Get info")) {
      events.push(event);
    }

    const toolStarts = events.filter((e) => e.type === "tool_execution_start");
    const toolEnds = events.filter((e) => e.type === "tool_execution_end");

    expect(toolStarts).toHaveLength(2);
    expect(toolEnds).toHaveLength(2);
  });

  it("should handle tool execution errors", async () => {
    const failingTool = defineTool({
      name: "fail_tool",
      description: "Always fails",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("Tool execution failed");
      },
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "fail_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Sorry, the tool failed.")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [failingTool],
    });

    const events: any[] = [];
    for await (const event of agent.run("Use failing tool")) {
      events.push(event);
    }

    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.isError).toBe(true);
    expect(toolEnd.result.content[0].text).toContain("Tool execution failed");
  });

  it("should handle unknown tool calls", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "unknown_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("I don't know that tool.")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [], // No tools registered
    });

    const events: any[] = [];
    for await (const event of agent.run("Call unknown tool")) {
      events.push(event);
    }

    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.isError).toBe(true);
    expect(toolEnd.result.content[0].text).toContain('Unknown tool "unknown_tool"');
  });
});

describe("Agent E2E - Advanced Features", () => {
  it("should support beforeToolCall hook", async () => {
    const tool = defineTool({
      name: "sensitive_tool",
      description: "Sensitive operation",
      parameters: z.object({}),
      execute: async () => ({
        content: [{ type: "text", text: "Done" }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "sensitive_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Blocked")],
    ]);
    registerProvider(mockProvider);

    const beforeHook = vi.fn().mockResolvedValue({ block: true, reason: "Not allowed" });

    const agent = new Agent({
      model: testModel,
      tools: [tool],
      beforeToolCall: beforeHook,
    });

    for await (const _ of agent.run("Use sensitive tool")) {
      // consume
    }

    expect(beforeHook).toHaveBeenCalled();
    
    // The tool should have been blocked
    const toolEnd = agent.messages.find((m: Message) => 
      m.role === "toolResult" && m.toolName === "sensitive_tool"
    );
    expect(toolEnd).toBeDefined();
    if (toolEnd?.role === "toolResult") {
      expect(toolEnd.isError).toBe(true);
    }
  });

  it("should support afterToolCall hook", async () => {
    const tool = defineTool({
      name: "data_tool",
      description: "Get data",
      parameters: z.object({}),
      execute: async () => ({
        content: [{ type: "text", text: "Raw data" }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "data_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Processed")],
    ]);
    registerProvider(mockProvider);

    const afterHook = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Modified data" }],
    });

    const agent = new Agent({
      model: testModel,
      tools: [tool],
      afterToolCall: afterHook,
    });

    for await (const _ of agent.run("Get data")) {
      // consume
    }

    expect(afterHook).toHaveBeenCalled();
  });

  it("should support sequential tool execution", async () => {
    const executionOrder: string[] = [];
    
    const tool1 = defineTool({
      name: "tool_a",
      description: "Tool A",
      parameters: z.object({}),
      execute: async () => {
        executionOrder.push("A");
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { content: [{ type: "text", text: "A" }] };
      },
    });

    const tool2 = defineTool({
      name: "tool_b",
      description: "Tool B",
      parameters: z.object({}),
      execute: async () => {
        executionOrder.push("B");
        return { content: [{ type: "text", text: "B" }] };
      },
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "tool_a",
            arguments: {},
          },
          {
            type: "toolCall",
            id: "call_2",
            name: "tool_b",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Done")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool1, tool2],
      toolExecution: "sequential",
    });

    for await (const _ of agent.run("Sequential test")) {
      // consume
    }

    // In sequential mode, B should execute after A completes
    expect(executionOrder).toEqual(["A", "B"]);
  });

  it("should handle abort signal", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Slow response")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    // Start the agent
    const generator = agent.run("Test abort");
    
    // Get first event
    const firstEvent = await generator.next();
    expect(firstEvent.done).toBe(false);

    // Abort
    agent.abort();

    // Continue consuming - should finish
    const remaining: any[] = [];
    for await (const event of generator) {
      remaining.push(event);
    }

    // Should have completed (not hang)
    expect(agent.isStreaming).toBe(false);
  });

  it("should not hang when transformContext hook throws unexpectedly", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Response")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      transformContext: () => {
        throw new Error("Unexpected transformation failure");
      },
    });

    const events: any[] = [];
    for await (const event of agent.run("Test")) {
      events.push(event);
    }

    // Must have completed without hanging
    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
    expect(agent.isStreaming).toBe(false);
  });

  it("should reset state correctly", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Response")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    for await (const _ of agent.run("Test")) {
      // consume
    }

    expect(agent.messages.length).toBeGreaterThan(0);
    
    agent.reset();
    
    expect(agent.messages).toEqual([]);
    expect(agent.isStreaming).toBe(false);
    expect(agent.streamingMessage).toBeUndefined();
    expect(agent.pendingToolCalls.size).toBe(0);
  });

  it("should emit agent events to subscribers", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Hello")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    const subscriberEvents: any[] = [];
    const unsubscribe = agent.subscribe((event) => {
      subscriberEvents.push(event);
    });

    for await (const _ of agent.run("Test")) {
      // consume
    }

    expect(subscriberEvents.length).toBeGreaterThan(0);
    expect(subscriberEvents.some((e) => e.type === "agent_start")).toBe(true);
    expect(subscriberEvents.some((e) => e.type === "agent_end")).toBe(true);

    unsubscribe();
  });

  it("should handle beforeToolCall hook that throws without hanging", async () => {
    const tool = defineTool({
      name: "normal_tool",
      description: "A normal tool",
      parameters: z.object({}),
      execute: async () => ({
        content: [{ type: "text", text: "Done" }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "normal_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Recovered")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool],
      beforeToolCall: () => {
        throw new Error("Hook crash!");
      },
    });

    const events: any[] = [];
    for await (const event of agent.run("Test")) {
      events.push(event);
    }

    // Must finish without hanging
    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();

    // The tool should be marked as blocked with the hook error
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.isError).toBe(true);
  });

  it("should handle afterToolCall hook that throws without hanging", async () => {
    const tool = defineTool({
      name: "normal_tool",
      description: "A normal tool",
      parameters: z.object({}),
      execute: async () => ({
        content: [{ type: "text", text: "Done" }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "normal_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("Recovered")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool],
      afterToolCall: () => {
        throw new Error("Hook crash!");
      },
    });

    const events: any[] = [];
    for await (const event of agent.run("Test")) {
      events.push(event);
    }

    // Must finish without hanging
    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();

    // The tool result should still be the original (not overridden by failed hook)
    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.isError).toBe(false);
    expect(toolEnd.result.content[0].text).toBe("Done");
  });

  it("should isolate listener errors so one failing subscriber does not break others", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Hello")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    const goodEvents: any[] = [];
    const badListener = vi.fn().mockImplementation(() => {
      throw new Error("Listener crash!");
    });
    const goodListener = vi.fn().mockImplementation((event) => {
      goodEvents.push(event);
    });

    agent.subscribe(badListener);
    agent.subscribe(goodListener);

    for await (const _ of agent.run("Test")) {
      // consume
    }

    // Bad listener should have been called and thrown
    expect(badListener).toHaveBeenCalled();
    // Good listener should still have received events despite bad listener crashing
    expect(goodListener).toHaveBeenCalled();
    expect(goodEvents.some((e) => e.type === "agent_start")).toBe(true);
    expect(goodEvents.some((e) => e.type === "agent_end")).toBe(true);
  });

  it("should emit tool_execution_update events to generator consumers", async () => {
    const updatingTool = defineTool({
      name: "progress_tool",
      description: "Reports progress via onUpdate",
      parameters: z.object({}),
      execute: async (_args, { onUpdate }) => {
        if (onUpdate) {
          onUpdate({ content: [{ type: "text", text: "25%" }] });
          onUpdate({ content: [{ type: "text", text: "50%" }] });
          onUpdate({ content: [{ type: "text", text: "75%" }] });
        }
        return { content: [{ type: "text", text: "100%" }] };
      },
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "progress_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("All done")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [updatingTool],
    });

    const events: any[] = [];
    for await (const event of agent.run("Run progress tool")) {
      events.push(event);
    }

    const updateEvents = events.filter((e) => e.type === "tool_execution_update");
    expect(updateEvents.length).toBe(3);
    expect(updateEvents[0].partialResult.content[0].text).toBe("25%");
    expect(updateEvents[1].partialResult.content[0].text).toBe("50%");
    expect(updateEvents[2].partialResult.content[0].text).toBe("75%");

    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
  });

  it("should also emit tool_execution_update events to subscriber listeners", async () => {
    const updatingTool = defineTool({
      name: "progress_tool",
      description: "Reports progress via onUpdate",
      parameters: z.object({}),
      execute: async (_args, { onUpdate }) => {
        if (onUpdate) {
          onUpdate({ content: [{ type: "text", text: "step 1" }] });
        }
        return { content: [{ type: "text", text: "done" }] };
      },
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "progress_tool",
            arguments: {},
          },
        ]),
      ],
      [createTextMessage("All done")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [updatingTool],
    });

    const subscriberUpdates: any[] = [];
    agent.subscribe((event) => {
      if (event.type === "tool_execution_update") {
        subscriberUpdates.push(event);
      }
    });

    for await (const _ of agent.run("Run progress tool")) {
      // consume
    }

    expect(subscriberUpdates.length).toBe(1);
    expect(subscriberUpdates[0].partialResult.content[0].text).toBe("step 1");
  });

  it("should support transformContext hook", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createTextMessage("Transformed")],
    ]);
    registerProvider(mockProvider);

    const transformFn = vi.fn().mockImplementation((messages: Message[]) => {
      return [
        ...messages,
        {
          role: "user",
          content: "[Transformed]",
          timestamp: Date.now(),
        } as Message,
      ];
    });

    const agent = new Agent({
      model: testModel,
      transformContext: transformFn,
    });

    for await (const _ of agent.run("Test")) {
      // consume
    }

    expect(transformFn).toHaveBeenCalled();
  });
});

describe("Agent E2E - Complex Scenarios", () => {
  it("should handle multi-turn conversation with tools", async () => {
    const calculator = defineTool({
      name: "calculate",
      description: "Calculate",
      parameters: z.object({ expression: z.string() }),
      execute: async (args) => ({
        content: [{ type: "text", text: `Result: ${args.expression}` }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "calculate",
            arguments: { expression: "2+2" },
          },
        ]),
      ],
      [createTextMessage("The result is 4")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [calculator],
    });

    const events: any[] = [];
    for await (const event of agent.run("Calculate 2+2")) {
      events.push(event);
    }

    // Should have tool execution events
    const toolEvents = events.filter((e) => 
      e.type === "tool_execution_start" || e.type === "tool_execution_end"
    );
    expect(toolEvents.length).toBe(2);

    // Final message should be the assistant's response
    const finalMessages = agent.messages;
    const assistantMessages = finalMessages.filter((m: Message) => m.role === "assistant");
    expect(assistantMessages.length).toBeGreaterThan(0);
  });

  it("should handle empty tool calls gracefully", async () => {
    const mockProvider = createMockProvider("test-provider", [
      [createToolCallMessage([])], // Empty tool calls
      [createTextMessage("No tools needed")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
    });

    const events: any[] = [];
    for await (const event of agent.run("Test")) {
      events.push(event);
    }

    // Should complete without errors
    const agentEnd = events.find((e) => e.type === "agent_end");
    expect(agentEnd).toBeDefined();
  });

  it("should validate tool arguments with Zod schema", async () => {
    const tool = defineTool({
      name: "strict_tool",
      description: "Requires specific args",
      parameters: z.object({
        count: z.number().min(1).max(10),
        name: z.string().min(1),
      }),
      execute: async (args) => ({
        content: [{ type: "text", text: `Count: ${args.count}, Name: ${args.name}` }],
      }),
    });

    const mockProvider = createMockProvider("test-provider", [
      [
        createToolCallMessage([
          {
            type: "toolCall",
            id: "call_1",
            name: "strict_tool",
            arguments: { count: 5, name: "test" },
          },
        ]),
      ],
      [createTextMessage("Done")],
    ]);
    registerProvider(mockProvider);

    const agent = new Agent({
      model: testModel,
      tools: [tool],
    });

    const events: any[] = [];
    for await (const event of agent.run("Use strict tool")) {
      events.push(event);
    }

    const toolEnd = events.find((e) => e.type === "tool_execution_end");
    expect(toolEnd).toBeDefined();
    expect(toolEnd.isError).toBe(false);
  });
});
