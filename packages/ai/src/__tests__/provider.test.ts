import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerProvider, getProvider, listProviders, stream } from "../registry.js";
import { createAnthropicProvider } from "../providers/anthropic.js";
import type { Model, Context } from "../types.js";

describe("Provider Registry", () => {
  beforeEach(() => {
    registerProvider(createAnthropicProvider());
  });

  it("should register and retrieve provider", () => {
    const provider = getProvider("anthropic");
    expect(provider).toBeDefined();
    expect(provider?.name).toBe("anthropic");
  });

  it("should list all registered providers", () => {
    const providers = listProviders();
    expect(providers).toContain("anthropic");
  });

  it("should return undefined for unknown provider", () => {
    const provider = getProvider("unknown");
    expect(provider).toBeUndefined();
  });
});

describe("Anthropic Provider", () => {
  it("should create provider with correct name", () => {
    const provider = createAnthropicProvider();
    expect(provider.name).toBe("anthropic");
  });

  it("should create stream that emits error without API key", async () => {
    const provider = createAnthropicProvider();
    const model: Model = { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", api: "anthropic-messages" };
    const context: Context = { messages: [{ role: "user", content: "Hello", timestamp: Date.now() }] };

    const stream = provider.stream(model, context);

    const events: string[] = [];
    for await (const event of stream) {
      events.push(event.type);
    }

    expect(events).toContain("start");
    expect(events).toContain("error");
  });
});
