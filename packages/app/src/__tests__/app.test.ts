import { describe, it, expect } from "vitest";
import { SessionManager, InMemorySessionStore, SimpleOrchestrator, SimpleRateLimiter } from "../index.js";
import type { Model } from "@spectra/ai";

const testModel: Model = {
  id: "test-model",
  name: "Test Model",
  provider: "test",
  api: "test",
};

describe("SessionManager", () => {
  it("should create a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({
      model: testModel,
      systemPrompt: "You are a test assistant",
    });

    expect(session.id).toBeDefined();
    expect(session.model).toEqual(testModel);
    expect(session.messages).toEqual([]);
  });

  it("should load a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const created = await manager.create({ model: testModel });
    const loaded = await manager.load(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
  });

  it("should save a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    session.messages = [{ role: "user", content: "Hello", timestamp: Date.now() }];
    
    await manager.save(session);
    const loaded = await manager.load(session.id);

    expect(loaded?.messages).toHaveLength(1);
  });

  it("should fork a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const original = await manager.create({ model: testModel });
    original.messages = [
      { role: "user", content: "Hello", timestamp: Date.now() },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }], timestamp: Date.now() },
      { role: "user", content: "How are you?", timestamp: Date.now() },
    ];
    await manager.save(original);

    const forked = await manager.fork(original.id, 1);

    expect(forked.id).not.toBe(original.id);
    expect(forked.messages).toHaveLength(2);
    expect(forked.metadata.parentSessionId).toBe(original.id);
  });
});

describe("InMemorySessionStore", () => {
  it("should list sessions", async () => {
    const store = new InMemorySessionStore();
    
    await store.create({
      id: "test-id",
      model: testModel,
      messages: [],
      config: { model: testModel },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turnCount: 0,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        isStreaming: false,
      },
    });

    const sessions = await store.list();
    expect(sessions).toHaveLength(1);
  });
});

describe("SimpleOrchestrator", () => {
  it("should register agents", () => {
    const orchestrator = new SimpleOrchestrator();
    
    orchestrator.registerAgent("test", {
      model: testModel,
      systemPrompt: "You are a test agent",
    });

    expect(orchestrator).toBeDefined();
  });

  it("should return error for unknown agent type", async () => {
    const orchestrator = new SimpleOrchestrator();
    
    const result = await orchestrator.delegate("unknown", "test task");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown agent type");
  });
});

describe("SimpleRateLimiter", () => {
  it("should allow requests within limit", async () => {
    const limiter = new SimpleRateLimiter(10, 60000);
    
    const result = await limiter.checkLimit("user1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it("should block requests over limit", async () => {
    const limiter = new SimpleRateLimiter(2, 60000);
    
    await limiter.checkLimit("user1");
    await limiter.checkLimit("user1");
    const result = await limiter.checkLimit("user1");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
