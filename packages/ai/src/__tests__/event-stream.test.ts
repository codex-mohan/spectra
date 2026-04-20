import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventStream, AssistantMessageEventStream } from "../event-stream.js";

describe("EventStream", () => {
  it("should queue events and deliver them in order", async () => {
    const stream = new EventStream<string, string>(
      (e) => e === "end",
      (e) => e
    );

    const events: string[] = [];
    stream.push("hello");
    stream.push("world");
    stream.push("end");

    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual(["hello", "world", "end"]);
  });

  it("should resolve result on completion", async () => {
    const stream = new EventStream<string, number>(
      (e) => e === "done",
      (e) => 42
    );

    stream.push("some event");
    stream.push("done");
    stream.end();

    const result = await stream.result();
    expect(result).toBe(42);
  });

  it("should handle push after partial consumption", async () => {
    const stream = new EventStream<number, number>(
      (e) => e === -1,
      (e) => e
    );

    stream.push(1);
    stream.push(2);

    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.value).toBe(1);
    expect(first.done).toBe(false);

    stream.push(3);

    const second = await iterator.next();
    expect(second.value).toBe(2);
    expect(second.done).toBe(false);

    const third = await iterator.next();
    expect(third.value).toBe(3);
    expect(third.done).toBe(false);
  });
});

describe("AssistantMessageEventStream", () => {
  it("should resolve result on done event", async () => {
    const stream = new AssistantMessageEventStream();

    stream.push({ type: "start", partial: { role: "assistant", content: [], provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() } });
    stream.push({ type: "text_start", contentIndex: 0, partial: {} as any });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "Hello", partial: {} as any });
    stream.push({
      type: "done",
      reason: "stop",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello" }],
        provider: "test",
        model: "test",
        usage: { input: 5, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    });

    const result = await stream.result();
    expect(result.stopReason).toBe("stop");
    expect(result.content[0]).toEqual({ type: "text", text: "Hello" });
  });

  it("should resolve result on error event", async () => {
    const stream = new AssistantMessageEventStream();

    stream.push({ type: "error", reason: "error", error: { role: "assistant", content: [], provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "error", errorMessage: "Something went wrong", timestamp: Date.now() } });

    const result = await stream.result();
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Something went wrong");
  });

  it("should iterate events in order", async () => {
    const stream = new AssistantMessageEventStream();
    const events: string[] = [];

    stream.push({ type: "start", partial: { role: "assistant", content: [], provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() } });
    stream.push({ type: "text_start", contentIndex: 0, partial: {} as any });
    stream.push({ type: "text_delta", contentIndex: 0, delta: "Hi", partial: {} as any });
    stream.push({
      type: "done",
      reason: "stop",
      message: { role: "assistant", content: [{ type: "text", text: "Hi" }], provider: "test", model: "test", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: "stop", timestamp: Date.now() },
    });

    for await (const event of stream) {
      events.push(event.type);
    }

    expect(events).toEqual(["start", "text_start", "text_delta", "done"]);
  });
});
