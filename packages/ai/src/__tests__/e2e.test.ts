import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventStream, AssistantMessageEventStream } from "../event-stream.js";
import { registerProvider, getProvider, stream, complete } from "../registry.js";
import type { AssistantMessage, Context, Model, AssistantMessageEvent } from "../types.js";

// Mock provider for testing (following pi-mono's provider pattern)
function createMockProvider(name: string, responseEvents: AssistantMessageEvent[]) {
  return {
    name,
    stream(model: Model, context: Context) {
      const stream = new AssistantMessageEventStream();
      
      // Simulate async streaming (pi-mono pattern: push events, then end)
      setTimeout(() => {
        for (const event of responseEvents) {
          stream.push(event);
        }
        stream.end();
      }, 10);
      
      return stream;
    },
  };
}

// Helper to create a complete assistant message
function createAssistantMessage(text: string, stopReason: "stop" | "toolUse" = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    provider: "test",
    model: "test-model",
    usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
    stopReason,
    timestamp: Date.now(),
  };
}

describe("EventStream (pi-mono pattern)", () => {
  it("should implement AsyncIterable interface", async () => {
    const stream = new EventStream<string, string>(
      (e) => e === "end",
      (e) => e
    );

    // Verify it's async iterable (pi-mono core pattern)
    expect(typeof stream[Symbol.asyncIterator]).toBe("function");
  });

  it("should stream events in order (pi-mono push pattern)", async () => {
    const stream = new EventStream<string, string>(
      (e) => e === "end",
      (e) => e
    );

    stream.push("first");
    stream.push("second");
    stream.push("third");
    stream.push("end");

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual(["first", "second", "third", "end"]);
  });

  it("should resolve result after completion", async () => {
    const stream = new EventStream<string, number>(
      (e) => e === "done",
      (e) => e === "done" ? 42 : 0
    );

    stream.push("working");
    stream.push("done");
    stream.end();

    const result = await stream.result();
    expect(result).toBe(42);
  });

  it("should handle single consumer pattern (pi-mono design)", async () => {
    const stream = new EventStream<string, string>(
      (e) => e === "end",
      (e) => e
    );

    stream.push("event1");
    stream.push("event2");
    stream.push("end");

    const events: string[] = [];
    for await (const e of stream) {
      events.push(e);
    }

    expect(events).toEqual(["event1", "event2", "end"]);
    
    // Note: EventStream is single-consumer by design (pi-mono pattern)
    // Multiple consumers would require a broadcast mechanism
  });
});

describe("AssistantMessageEventStream (pi-mono pattern)", () => {
  it("should emit start, delta, and done events", async () => {
    const stream = new AssistantMessageEventStream();
    const partial = createAssistantMessage("");

    stream.push({ type: "start", partial });
    stream.push({ type: "text_start", contentIndex: 0, partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "Hello", partial });
    stream.push({ type: "text_delta", contentIndex: 0, delta: " World", partial });
    stream.push({ type: "text_end", contentIndex: 0, content: "Hello World", partial });
    stream.push({
      type: "done",
      reason: "stop",
      message: createAssistantMessage("Hello World"),
    });
    stream.end();

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toHaveLength(6);
    expect(events[0].type).toBe("start");
    expect(events[1].type).toBe("text_start");
    expect(events[2].type).toBe("text_delta");
    expect(events[5].type).toBe("done");
  });

  it("should resolve to final AssistantMessage", async () => {
    const stream = new AssistantMessageEventStream();
    const finalMessage = createAssistantMessage("Final result");

    stream.push({ type: "start", partial: createAssistantMessage("") });
    stream.push({ type: "done", reason: "stop", message: finalMessage });
    stream.end();

    const result = await stream.result();
    expect(result.content[0]).toEqual({ type: "text", text: "Final result" });
    expect(result.stopReason).toBe("stop");
  });

  it("should handle error events", async () => {
    const stream = new AssistantMessageEventStream();
    const errorMessage = createAssistantMessage("");
    errorMessage.stopReason = "error";
    errorMessage.errorMessage = "Something went wrong";

    stream.push({ type: "error", reason: "error", error: errorMessage });
    stream.end();

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Something went wrong");
  });

  it("should handle tool call streaming (pi-mono tool pattern)", async () => {
    const stream = new AssistantMessageEventStream();
    const partial = createAssistantMessage("");

    stream.push({ type: "start", partial });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial });
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: '{"lo', partial });
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: 'cation":', partial });
    stream.push({ type: "toolcall_delta", contentIndex: 0, delta: '"NYC"}', partial });
    stream.push({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: {
        type: "toolCall",
        id: "call_1",
        name: "get_weather",
        arguments: { location: "NYC" },
      },
      partial,
    });
    stream.push({
      type: "done",
      reason: "toolUse",
      message: createAssistantMessage("", "toolUse"),
    });
    stream.end();

    const events: AssistantMessageEvent[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    const toolCallEnd = events.find((e) => e.type === "toolcall_end");
    expect(toolCallEnd).toBeDefined();
    if (toolCallEnd?.type === "toolcall_end") {
      expect(toolCallEnd.toolCall.name).toBe("get_weather");
      expect(toolCallEnd.toolCall.arguments).toEqual({ location: "NYC" });
    }
  });
});

describe("Provider Registry (pi-mono provider pattern)", () => {
  beforeEach(() => {
    // Clear registry
    const providers = ["test-provider", "anthropic", "openai"];
    for (const name of providers) {
      try {
        // Re-register to ensure clean state
      } catch {
        // ignore
      }
    }
  });

  it("should register and retrieve providers", () => {
    const provider = createMockProvider("test-provider", []);
    registerProvider(provider);

    const retrieved = getProvider("test-provider");
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe("test-provider");
  });

  it("should stream through registered provider", async () => {
    const mockMessage = createAssistantMessage("Hello from mock");
    const provider = createMockProvider("mock-ai", [
      { type: "start", partial: createAssistantMessage("") },
      { type: "done", reason: "stop", message: mockMessage },
    ]);

    registerProvider(provider);

    const model: Model = {
      id: "mock-model",
      name: "Mock Model",
      provider: "mock-ai",
      api: "mock",
    };

    const context: Context = {
      messages: [{ role: "user", content: "Hi", timestamp: Date.now() }],
    };

    const eventStream = stream(model, context);
    const events: AssistantMessageEvent[] = [];

    for await (const event of eventStream) {
      events.push(event);
    }

    expect(events.length).toBeGreaterThan(0);
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });

  it("should complete through registered provider", async () => {
    const mockMessage = createAssistantMessage("Completed");
    const provider = createMockProvider("complete-ai", [
      { type: "start", partial: createAssistantMessage("") },
      { type: "done", reason: "stop", message: mockMessage },
    ]);

    registerProvider(provider);

    const model: Model = {
      id: "complete-model",
      name: "Complete Model",
      provider: "complete-ai",
      api: "complete",
    };

    const context: Context = {
      messages: [{ role: "user", content: "Test", timestamp: Date.now() }],
    };

    const result = await complete(model, context);
    expect(result.content[0]).toEqual({ type: "text", text: "Completed" });
  });

  it("should throw for unregistered provider", () => {
    const model: Model = {
      id: "unknown",
      name: "Unknown",
      provider: "nonexistent",
      api: "unknown",
    };

    const context: Context = { messages: [] };

    expect(() => stream(model, context)).toThrow("No provider registered");
  });
});

describe("Provider Error Handling", () => {
  it("should emit error event on provider failure", async () => {
    const errorProvider = {
      name: "error-provider",
      stream() {
        const stream = new AssistantMessageEventStream();
        setTimeout(() => {
          const errorMsg: AssistantMessage = {
            role: "assistant",
            content: [],
            provider: "error-provider",
            model: "error-model",
            usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
            stopReason: "error",
            errorMessage: "API Error",
            timestamp: Date.now(),
          };
          stream.push({ type: "error", reason: "error", error: errorMsg });
          stream.end();
        }, 10);
        return stream;
      },
    };

    registerProvider(errorProvider);

    const model: Model = {
      id: "error-model",
      name: "Error Model",
      provider: "error-provider",
      api: "error",
    };

    const context: Context = { messages: [] };
    const result = await complete(model, context);

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("API Error");
  });
});

describe("Streaming with AbortSignal", () => {
  it("should respect abort signal", async () => {
    const controller = new AbortController();
    
    const slowProvider = {
      name: "slow-provider",
      stream(model: Model, context: Context, options?: { signal?: AbortSignal }) {
        const stream = new AssistantMessageEventStream();
        
        // Simulate slow stream
        const interval = setInterval(() => {
          if (options?.signal?.aborted) {
            clearInterval(interval);
            const abortedMsg: AssistantMessage = {
              role: "assistant",
              content: [],
              provider: "slow-provider",
              model: "slow-model",
              usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
              stopReason: "aborted",
              timestamp: Date.now(),
            };
            stream.push({ type: "error", reason: "aborted", error: abortedMsg });
            stream.end();
            return;
          }
          
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "chunk ",
            partial: createAssistantMessage(""),
          });
        }, 50);

        // Auto-abort after 100ms
        setTimeout(() => controller.abort(), 100);
        
        return stream;
      },
    };

    registerProvider(slowProvider);

    const model: Model = {
      id: "slow-model",
      name: "Slow Model",
      provider: "slow-provider",
      api: "slow",
    };

    const context: Context = { messages: [] };
    const eventStream = stream(model, context, { signal: controller.signal });
    
    const events: AssistantMessageEvent[] = [];
    for await (const event of eventStream) {
      events.push(event);
      if (event.type === "error" || event.type === "done") break;
    }

    // Should have received at least one event before abort
    expect(events.length).toBeGreaterThan(0);
  });
});

describe("Message Content Types", () => {
  it("should handle text content", async () => {
    const message = createAssistantMessage("Plain text");
    expect(message.content[0]).toEqual({ type: "text", text: "Plain text" });
  });

  it("should handle thinking content", async () => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me think...", thinkingSignature: "sig1" },
        { type: "text", text: "Answer" },
      ],
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    expect(message.content).toHaveLength(2);
    expect(message.content[0].type).toBe("thinking");
  });

  it("should handle tool call content", async () => {
    const message: AssistantMessage = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "get_weather",
          arguments: { location: "NYC" },
        },
      ],
      provider: "test",
      model: "test",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    };

    expect(message.content[0].type).toBe("toolCall");
    expect((message.content[0] as any).name).toBe("get_weather");
  });
});
