import { describe, it, expect } from "vitest";
import { EventStream, isNativeLoaded, getVersion, createAgent } from "./native.js";

describe("EventStream", () => {
  it("push and iterate events", async () => {
    const stream = new EventStream();
    stream.push("event1");
    stream.push("event2");
    stream.end();

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual(["event1", "event2"]);
  });

  it("yields events pushed while iterating", async () => {
    const stream = new EventStream();
    const events: string[] = [];

    const iterPromise = (async () => {
      for await (const event of stream) {
        events.push(event);
      }
    })();

    await new Promise((r) => setTimeout(r, 10));
    stream.push("a");
    await new Promise((r) => setTimeout(r, 10));
    stream.push("b");
    stream.end();

    await iterPromise;
    expect(events).toEqual(["a", "b"]);
  });

  it("end without events returns immediately", async () => {
    const stream = new EventStream();
    stream.end();

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });

  it("ignores push after end", async () => {
    const stream = new EventStream();
    stream.push("before");
    stream.end();
    stream.push("after");

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event);
    }

    expect(events).toEqual(["before"]);
  });
});

describe("native bridge", () => {
  it("isNativeLoaded returns true when addon is available", () => {
    expect(isNativeLoaded()).toBe(true);
  });

  it("getVersion returns the native version string", () => {
    const version = getVersion();
    expect(typeof version).toBe("string");
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("createAgent returns a string agent ID", () => {
    const result = createAgent(
      JSON.stringify({
        model: { provider: "anthropic", id: "claude-3-haiku-20240307" },
      })
    );
    expect(typeof result).toBe("string");
    expect(result).toBeTruthy();
  });
});
