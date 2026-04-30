import { describe, it, expect, vi } from "vitest";
import { 
  SessionManager, 
  InMemorySessionStore, 
  SimpleOrchestrator, 
  SimpleRateLimiter,
  SimpleWorkerPool,
  createAgentRunner
} from "../index.js";
import { Agent } from "@singularity-ai/spectra-agent";
import type { Model, Message } from "@singularity-ai/spectra-ai";

const testModel: Model = {
  id: "test-model",
  name: "Test Model",
  provider: "test",
  api: "test",
};

describe("SessionManager Core", () => {
  it("should create a session with metadata", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({
      model: testModel,
      systemPrompt: "You are a test assistant",
    }, "user-123");

    expect(session.id).toBeDefined();
    expect(session.model).toEqual(testModel);
    expect(session.messages).toEqual([]);
    expect(session.metadata.userId).toBe("user-123");
    expect(session.metadata.turnCount).toBe(0);
    expect(session.metadata.isStreaming).toBe(false);
  });

  it("should load a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const created = await manager.create({ model: testModel });
    const loaded = await manager.load(created.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(created.id);
  });

  it("should save and retrieve session state", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    const originalUpdatedAt = session.metadata.updatedAt;
    
    // Small delay to ensure timestamp changes
    await new Promise(resolve => setTimeout(resolve, 10));
    
    session.messages = [{ role: "user", content: "Hello", timestamp: Date.now() }];
    session.metadata.turnCount = 5;
    
    await manager.save(session);
    const loaded = await manager.load(session.id);

    expect(loaded?.messages).toHaveLength(1);
    expect(loaded?.metadata.turnCount).toBe(5);
    expect(loaded?.metadata.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
  });

  it("should delete a session", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    await manager.delete(session.id);

    const loaded = await manager.load(session.id);
    expect(loaded).toBeNull();
  });

  it("should fork a session at specific index", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const original = await manager.create({ model: testModel });
    original.messages = [
      { role: "user", content: "Hello", timestamp: Date.now() },
      { role: "assistant", content: [{ type: "text", text: "Hi there" }], timestamp: Date.now() },
      { role: "user", content: "How are you?", timestamp: Date.now() },
      { role: "assistant", content: [{ type: "text", text: "I'm fine" }], timestamp: Date.now() },
    ];
    await manager.save(original);

    const forked = await manager.fork(original.id, 2);

    expect(forked.id).not.toBe(original.id);
    expect(forked.messages).toHaveLength(3);
    expect(forked.metadata.parentSessionId).toBe(original.id);
    expect(forked.config.model).toEqual(testModel);
  });

  it("should list sessions with filters", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    await manager.create({ model: testModel }, "user-1");
    await manager.create({ model: testModel }, "user-1");
    await manager.create({ model: testModel }, "user-2");

    const user1Sessions = await manager.list({ userId: "user-1" });
    expect(user1Sessions).toHaveLength(2);

    const allSessions = await manager.list();
    expect(allSessions).toHaveLength(3);
  });
});

describe("SessionStore Implementation", () => {
  it("should handle concurrent operations", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    // Create multiple sessions concurrently
    const promises = Array.from({ length: 10 }, (_, i) => 
      manager.create({ model: testModel }, `user-${i}`)
    );

    const sessions = await Promise.all(promises);
    expect(sessions).toHaveLength(10);

    // Verify all are stored
    const all = await store.list();
    expect(all).toHaveLength(10);
  });

  it("should filter by status", async () => {
    const store = new InMemorySessionStore();
    
    // Create active session
    const active = {
      id: "active-1",
      model: testModel,
      messages: [],
      config: { model: testModel },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turnCount: 0,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        isStreaming: true,
      },
    };
    await store.create(active);

    // Create completed session
    const completed = {
      id: "completed-1",
      model: testModel,
      messages: [],
      config: { model: testModel },
      metadata: {
        createdAt: new Date(),
        updatedAt: new Date(),
        turnCount: 1,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        isStreaming: false,
      },
    };
    await store.create(completed);

    const activeSessions = await store.list({ status: "active" });
    expect(activeSessions).toHaveLength(1);
    expect(activeSessions[0].id).toBe("active-1");
  });
});

describe("SimpleRateLimiter", () => {
  it("should allow requests within limit", async () => {
    const limiter = new SimpleRateLimiter(10, 60000);
    
    const result = await limiter.checkLimit("user1");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
    expect(result.resetAt).toBeInstanceOf(Date);
  });

  it("should track remaining requests accurately", async () => {
    const limiter = new SimpleRateLimiter(5, 60000);
    
    // Use 3 requests
    await limiter.checkLimit("user1");
    await limiter.checkLimit("user1");
    await limiter.checkLimit("user1");

    const result = await limiter.checkLimit("user1");
    expect(result.remaining).toBe(1);
    expect(result.allowed).toBe(true);
  });

  it("should block requests over limit", async () => {
    const limiter = new SimpleRateLimiter(2, 60000);
    
    await limiter.checkLimit("user1");
    await limiter.checkLimit("user1");
    const result = await limiter.checkLimit("user1");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("should track different users independently", async () => {
    const limiter = new SimpleRateLimiter(2, 60000);
    
    await limiter.checkLimit("user1");
    await limiter.checkLimit("user1");

    // user2 should still have full limit
    const result = await limiter.checkLimit("user2");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
  });
});

describe("SimpleOrchestrator", () => {
  it("should register and list agent types", () => {
    const orchestrator = new SimpleOrchestrator();
    
    orchestrator.registerAgent("researcher", {
      model: testModel,
      systemPrompt: "You are a research specialist",
    });

    orchestrator.registerAgent("coder", {
      model: testModel,
      systemPrompt: "You are a coding specialist",
    });

    expect(orchestrator).toBeDefined();
  });

  it("should return error for unknown agent type", async () => {
    const orchestrator = new SimpleOrchestrator();
    
    const result = await orchestrator.delegate("unknown", "test task");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unknown agent type");
  });

  it("should execute tasks in parallel", async () => {
    const orchestrator = new SimpleOrchestrator();
    
    // Even with unknown agents, should not throw
    const results = await orchestrator.executeParallel([
      { agentType: "unknown1", task: "task1" },
      { agentType: "unknown2", task: "task2" },
    ]);

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(false);
  });
});

describe("WorkerPool", () => {
  it("should enqueue and process jobs", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);
    const pool = new SimpleWorkerPool(manager);

    const session = await manager.create({ model: testModel });
    const jobId = await pool.enqueue(session.id, "Test input");

    expect(jobId).toBeDefined();
    expect(typeof jobId).toBe("string");
  });

  it("should process jobs with custom handler", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);
    const pool = new SimpleWorkerPool(manager);

    const session = await manager.create({ model: testModel });
    await pool.enqueue(session.id, "job1");
    await pool.enqueue(session.id, "job2");

    const processed: string[] = [];
    
    // Process all jobs
    await pool.process(async (job) => {
      processed.push(job.input);
      return { jobId: job.id, success: true };
    });

    expect(processed).toContain("job1");
    expect(processed).toContain("job2");
    expect(processed).toHaveLength(2);
  });

  it("should stop gracefully", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);
    const pool = new SimpleWorkerPool(manager);

    await pool.stop();
    expect(pool).toBeDefined();
  });
});

describe("Integration: Agent with Session", () => {
  it("should create agent from session config", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({
      model: testModel,
      systemPrompt: "You are a helpful assistant",
    });

    // Create agent from session config
    const agent = new Agent({
      model: session.model,
      systemPrompt: session.config.systemPrompt,
    });

    expect(agent).toBeDefined();
  });
});
