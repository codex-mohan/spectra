import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SessionManager,
  InMemorySessionStore,
  FileSystemSessionStore,
  SQLiteSessionStore,
  SimpleOrchestrator,
  SimpleRateLimiter,
  SimpleWorkerPool,
  createAgentRunner,
} from "../index.js";
import { Agent } from "@singularity-ai/spectra-agent";
import type { Model, Message } from "@singularity-ai/spectra-ai";

const testModel: Model = {
  id: "test-model",
  name: "Test Model",
  provider: "test",
  api: "test",
};

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), "spectra-app-test-"));
}

function cleanupTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

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
    expect(session.entries).toEqual([]);
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

    manager.appendMessage(session, { role: "user", content: "Hello", timestamp: Date.now() });
    session.metadata.turnCount = 5;

    await manager.save(session);
    const loaded = await manager.load(session.id);

    expect(loaded?.entries).toHaveLength(1);
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

  it("should fork a session at specific entry", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const original = await manager.create({ model: testModel });
    manager.appendMessage(original, { role: "user", content: "Hello", timestamp: Date.now() });
    manager.appendMessage(original, {
      role: "assistant",
      content: [{ type: "text", text: "Hi there" }],
      provider: "test",
      model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendMessage(original, { role: "user", content: "How are you?", timestamp: Date.now() });
    manager.appendMessage(original, {
      role: "assistant",
      content: [{ type: "text", text: "I'm fine" }],
      provider: "test",
      model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    await manager.save(original);

    const branchFromEntryId = original.entries[2].id;
    const forked = await manager.fork(original.id, branchFromEntryId);

    expect(forked.id).not.toBe(original.id);
    expect(forked.entries).toHaveLength(3);
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

  it("should build context from message entries", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "Hello", timestamp: Date.now() });
    manager.appendMessage(session, {
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
      provider: "test",
      model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendAudit(session, "tool_blocked", { toolName: "bash", reason: "safety policy" });
    manager.appendMessage(session, { role: "user", content: "What else?", timestamp: Date.now() });

    const ctx = manager.buildContext(session);
    expect(ctx.messages).toHaveLength(3); // 3 message entries, audit skipped
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[1].role).toBe("assistant");
    expect(ctx.messages[2].role).toBe("user");
    expect(ctx.model).toEqual(testModel);
  });

  it("should get branch and tree", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "A", timestamp: Date.now() });
    manager.appendMessage(session, {
      role: "assistant",
      content: [{ type: "text", text: "B" }],
      provider: "test",
      model: "test-model",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendMessage(session, { role: "user", content: "C", timestamp: Date.now() });

    const branch = manager.getBranch(session);
    expect(branch).toHaveLength(3);
    expect(branch[0].parentId).toBeNull();
    expect(branch[1].parentId).toBe(branch[0].id);
    expect(branch[2].parentId).toBe(branch[1].id);

    const tree = manager.getTree(session);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
  });

  it("should track model changes", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    const newModel: Model = { id: "gpt-4", name: "GPT-4", provider: "openai", api: "chat" };
    manager.appendModelChange(session, newModel);

    expect(session.model).toEqual(newModel);
    const entry = session.entries[0];
    expect(entry.type).toBe("model_change");
    expect(entry).toHaveProperty("provider", "openai");
    expect(entry).toHaveProperty("modelId", "gpt-4");
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
      entries: [],
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
      entries: [],
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

describe("FileSystemSessionStore", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  it("should create, load, save, delete, and list sessions", async () => {
    const store = new FileSystemSessionStore(tempDir);
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel }, "user-fs");
    manager.appendMessage(session, { role: "user", content: "Hello", timestamp: Date.now() });
    manager.appendMessage(session, {
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
      provider: "test",
      model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendAudit(session, "tool_blocked", { toolName: "bash", reason: "safety policy" });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.entries).toHaveLength(3);
    expect(loaded?.metadata.userId).toBe("user-fs");

    const listed = await manager.list();
    expect(listed).toHaveLength(1);

    await manager.delete(session.id);
    const deleted = await manager.load(session.id);
    expect(deleted).toBeNull();
  });

  it("should filter sessions by userId and status", async () => {
    const store = new FileSystemSessionStore(tempDir);
    const manager = new SessionManager(store);

    const active = await manager.create({ model: testModel }, "user-a");
    active.metadata.isStreaming = true;
    await manager.save(active);

    const completed = await manager.create({ model: testModel }, "user-a");
    completed.metadata.isStreaming = false;
    await manager.save(completed);

    const userB = await manager.create({ model: testModel }, "user-b");
    await manager.save(userB);

    const activeSessions = await manager.list({ status: "active" });
    expect(activeSessions).toHaveLength(1);

    const userASessions = await manager.list({ userId: "user-a" });
    expect(userASessions).toHaveLength(2);
  });

  it("should preserve structured assistant messages including thinking and tool calls", async () => {
    const store = new FileSystemSessionStore(tempDir);
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Let me plan this..." },
        { type: "toolCall", id: "call_1", name: "readFile", arguments: { path: "/tmp/test.txt" } },
      ],
      provider: "test",
      model: "test-model",
      usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    manager.appendMessage(session, {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "readFile",
      content: [{ type: "text", text: "file contents" }],
      isError: false,
      timestamp: Date.now(),
    });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    const msgEntry1 = loaded?.entries[0] as { type: "message"; message: Message & { role: "assistant" } };
    expect(msgEntry1.message.role).toBe("assistant");
    expect(msgEntry1.message.stopReason).toBe("toolUse");
    expect(msgEntry1.message.content).toHaveLength(2);
    expect((msgEntry1.message.content[0] as { type: string; thinking: string }).thinking).toBe("Let me plan this...");
    expect((msgEntry1.message.content[1] as { type: string; name: string }).name).toBe("readFile");

    const msgEntry2 = loaded?.entries[1] as { type: "message"; message: Message & { role: "toolResult" } };
    expect(msgEntry2.message.toolCallId).toBe("call_1");
  });
});

describe("SQLiteSessionStore", () => {
  let tempDir: string;
  let store: SQLiteSessionStore;

  beforeEach(() => {
    tempDir = createTempDir();
    store = new SQLiteSessionStore(join(tempDir, "test.db"));
  });

  afterEach(() => {
    store.close();
    cleanupTempDir(tempDir);
  });

  it("should create, load, save, delete, and list sessions", async () => {
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel }, "user-sql");
    manager.appendMessage(session, { role: "user", content: "Hello", timestamp: Date.now() });
    manager.appendMessage(session, {
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
      provider: "test",
      model: "test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendAudit(session, "context_transformed", { by: "extension-x" });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.entries).toHaveLength(3);
    expect(loaded?.metadata.userId).toBe("user-sql");

    const listed = await manager.list();
    expect(listed).toHaveLength(1);

    await manager.delete(session.id);
    const deleted = await manager.load(session.id);
    expect(deleted).toBeNull();
  });

  it("should filter sessions by userId and status", async () => {
    const manager = new SessionManager(store);

    const active = await manager.create({ model: testModel }, "user-a");
    active.metadata.isStreaming = true;
    await manager.save(active);

    const completed = await manager.create({ model: testModel }, "user-a");
    completed.metadata.isStreaming = false;
    await manager.save(completed);

    const userB = await manager.create({ model: testModel }, "user-b");
    await manager.save(userB);

    const activeSessions = await manager.list({ status: "active" });
    expect(activeSessions).toHaveLength(1);

    const userASessions = await manager.list({ userId: "user-a" });
    expect(userASessions).toHaveLength(2);
  });

  it("should preserve structured assistant messages including thinking and tool calls", async () => {
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Analyzing..." },
        { type: "toolCall", id: "call_2", name: "writeFile", arguments: { path: "/tmp/out.txt", content: "hello" } },
      ],
      provider: "test",
      model: "test-model",
      usage: { input: 5, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    manager.appendMessage(session, {
      role: "toolResult",
      toolCallId: "call_2",
      toolName: "writeFile",
      content: [{ type: "text", text: "written" }],
      isError: false,
      timestamp: Date.now(),
    });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    const msgEntry1 = loaded?.entries[0] as { type: "message"; message: Message & { role: "assistant" } };
    expect(msgEntry1.message.role).toBe("assistant");
    expect(msgEntry1.message.stopReason).toBe("toolUse");
    expect(msgEntry1.message.content).toHaveLength(2);
    expect((msgEntry1.message.content[0] as { type: string; thinking: string }).thinking).toBe("Analyzing...");
    expect((msgEntry1.message.content[1] as { type: string; name: string }).name).toBe("writeFile");

    const msgEntry2 = loaded?.entries[1] as { type: "message"; message: Message & { role: "toolResult" } };
    expect(msgEntry2.message.toolCallId).toBe("call_2");
  });

  it("should handle concurrent operations", async () => {
    const manager = new SessionManager(store);

    const promises = Array.from({ length: 10 }, (_, i) =>
      manager.create({ model: testModel }, `user-${i}`)
    );

    const sessions = await Promise.all(promises);
    expect(sessions).toHaveLength(10);

    const all = await store.list();
    expect(all).toHaveLength(10);
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

describe("DAG and Branching", () => {
  it("should create a linear chain with correct parentIds", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    const e1 = manager.appendMessage(session, { role: "user", content: "A", timestamp: Date.now() });
    const e2 = manager.appendMessage(session, { role: "user", content: "B", timestamp: Date.now() });
    const e3 = manager.appendMessage(session, { role: "user", content: "C", timestamp: Date.now() });

    expect(e1.parentId).toBeNull();
    expect(e2.parentId).toBe(e1.id);
    expect(e3.parentId).toBe(e2.id);
  });

  it("should fork from any entry point and preserve branch history", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "msg1", timestamp: Date.now() });
    const e2 = manager.appendMessage(session, { role: "user", content: "msg2", timestamp: Date.now() });
    manager.appendMessage(session, { role: "user", content: "msg3", timestamp: Date.now() });
    manager.appendMessage(session, { role: "user", content: "msg4", timestamp: Date.now() });
    await manager.save(session);

    // Fork from entry 2 (msg2) — should have msg1, msg2
    const forked = await manager.fork(session.id, e2.id);
    expect(forked.entries).toHaveLength(2);
    expect(forked.entries[0]).toHaveProperty("type", "message");
    expect(forked.entries[1]).toHaveProperty("type", "message");
  });

  it("should fork from middle and continue with new entries", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const original = await manager.create({ model: testModel });
    manager.appendMessage(original, { role: "user", content: "step1", timestamp: Date.now() });
    const branchPoint = manager.appendMessage(original, { role: "user", content: "step2", timestamp: Date.now() });
    manager.appendMessage(original, { role: "user", content: "step3", timestamp: Date.now() });
    await manager.save(original);

    const forked = await manager.fork(original.id, branchPoint.id);
    // Continue fork with new entries
    manager.appendMessage(forked, { role: "user", content: "alt-step3", timestamp: Date.now() });
    manager.appendMessage(forked, { role: "user", content: "alt-step4", timestamp: Date.now() });
    await manager.save(forked);

    expect(forked.entries).toHaveLength(4);
    expect(forked.entries[2]).toHaveProperty("type", "message");
    expect(forked.entries[3]).toHaveProperty("type", "message");

    // Original should still have 3 entries
    const reloadedOriginal = await manager.load(original.id);
    expect(reloadedOriginal?.entries).toHaveLength(3);
  });

  it("should getBranch from different entry points", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    const e1 = manager.appendMessage(session, { role: "user", content: "1", timestamp: Date.now() });
    const e2 = manager.appendMessage(session, { role: "user", content: "2", timestamp: Date.now() });
    const e3 = manager.appendMessage(session, { role: "user", content: "3", timestamp: Date.now() });

    const branchToEnd = manager.getBranch(session);
    expect(branchToEnd).toHaveLength(3);

    const branchToE2 = manager.getBranch(session, e2.id);
    expect(branchToE2).toHaveLength(2);
    expect(branchToE2[0].id).toBe(e1.id);
    expect(branchToE2[1].id).toBe(e2.id);

    const branchToE1 = manager.getBranch(session, e1.id);
    expect(branchToE1).toHaveLength(1);
    expect(branchToE1[0].id).toBe(e1.id);
  });

  it("should build context that filters non-message entries", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "Hello", timestamp: Date.now() });
    manager.appendModelChange(session, { id: "gpt-4", name: "GPT-4", provider: "openai", api: "chat" });
    manager.appendMessage(session, {
      role: "assistant",
      content: [{ type: "text", text: "Hi" }],
      provider: "openai",
      model: "gpt-4",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
      stopReason: "stop",
      timestamp: Date.now(),
    });
    manager.appendAudit(session, "tool_blocked", { toolName: "bash", reason: "policy" });
    manager.appendCustom(session, "my-extension", { state: "active" });
    manager.appendMessage(session, { role: "user", content: "Bye", timestamp: Date.now() });

    const ctx = manager.buildContext(session);
    expect(ctx.messages).toHaveLength(3); // Only message entries
    expect(ctx.messages[0].role).toBe("user");
    expect(ctx.messages[1].role).toBe("assistant");
    expect(ctx.messages[2].role).toBe("user");
    expect(ctx.model.id).toBe("gpt-4"); // Model was updated
  });

  it("should getTree with nested structure", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "root", timestamp: Date.now() });
    manager.appendMessage(session, { role: "user", content: "child1", timestamp: Date.now() });
    manager.appendMessage(session, { role: "user", content: "grandchild", timestamp: Date.now() });

    const tree = manager.getTree(session);
    expect(tree).toHaveLength(1);
    expect(tree[0].entry).toHaveProperty("type", "message");
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].children).toHaveLength(1);
    expect(tree[0].children[0].children[0].children).toHaveLength(0);
  });

  it("should track leafId correctly", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    expect(manager.getLeafId(session)).toBeNull();

    const e1 = manager.appendMessage(session, { role: "user", content: "1", timestamp: Date.now() });
    expect(manager.getLeafId(session)).toBe(e1.id);

    const e2 = manager.appendMessage(session, { role: "user", content: "2", timestamp: Date.now() });
    expect(manager.getLeafId(session)).toBe(e2.id);
  });

  it("should persist and reload audit entries", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, { role: "user", content: "test", timestamp: Date.now() });
    manager.appendAudit(session, "beforeToolCall_blocked", {
      toolName: "writeFile",
      blockedBy: "safety-hook",
      reason: "write to /etc is not allowed",
    });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    expect(loaded?.entries).toHaveLength(2);
    const auditEntry = loaded?.entries[1] as { type: string; eventType: string; details: Record<string, unknown> };
    expect(auditEntry.type).toBe("audit");
    expect(auditEntry.eventType).toBe("beforeToolCall_blocked");
    expect(auditEntry.details.blockedBy).toBe("safety-hook");
    expect(auditEntry.details.reason).toBe("write to /etc is not allowed");
  });

  it("should persist and reload custom entries", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendCustom(session, "my-extension", { key: "value", nested: { a: 1 } });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    expect(loaded?.entries).toHaveLength(1);
    const customEntry = loaded?.entries[0] as { type: string; customType: string; data: unknown };
    expect(customEntry.type).toBe("custom");
    expect(customEntry.customType).toBe("my-extension");
    expect(customEntry.data).toEqual({ key: "value", nested: { a: 1 } });
  });

  it("should persist provenance in tool result messages", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    manager.appendMessage(session, {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      content: [{ type: "text", text: "blocked" }],
      isError: true,
      timestamp: Date.now(),
      provenance: {
        blockedBy: "safety-extension",
        blockReason: "rm -rf / is not allowed",
        retryCount: 2,
        hookDetails: { policy: "destructive-filesystem" },
      },
    });
    await manager.save(session);

    const loaded = await manager.load(session.id);
    const entry = loaded?.entries[0] as { type: "message"; message: Message & { role: "toolResult" } };
    expect(entry.message.provenance).toBeDefined();
    expect(entry.message.provenance?.blockedBy).toBe("safety-extension");
    expect(entry.message.provenance?.blockReason).toBe("rm -rf / is not allowed");
    expect(entry.message.provenance?.retryCount).toBe(2);
  });

  it("should handle deep tree structures correctly", async () => {
    const store = new InMemorySessionStore();
    const manager = new SessionManager(store);

    const session = await manager.create({ model: testModel });
    const entries = [];
    for (let i = 0; i < 50; i++) {
      entries.push(manager.appendMessage(session, { role: "user", content: `msg-${i}`, timestamp: Date.now() }));
    }

    const branch = manager.getBranch(session);
    expect(branch).toHaveLength(50);

    // Verify chain integrity
    for (let i = 1; i < branch.length; i++) {
      expect(branch[i].parentId).toBe(branch[i - 1].id);
    }

    const tree = manager.getTree(session);
    expect(tree).toHaveLength(1);
    // Tree should be deeply nested
    let depth = 0;
    let node = tree[0];
    while (node.children.length > 0) {
      depth++;
      node = node.children[0];
    }
    expect(depth).toBe(49);
  });

  it("should handle multiple session stores with the same manager", async () => {
    const tempDir = createTempDir();
    try {
      const fsStore = new FileSystemSessionStore(tempDir);
      const sqliteStore = new SQLiteSessionStore(join(tempDir, "test.db"));
      const fsManager = new SessionManager(fsStore);
      const sqliteManager = new SessionManager(sqliteStore);

      const fsSession = await fsManager.create({ model: testModel }, "fs-user");
      fsManager.appendMessage(fsSession, { role: "user", content: "fs", timestamp: Date.now() });
      await fsManager.save(fsSession);

      const sqliteSession = await sqliteManager.create({ model: testModel }, "sqlite-user");
      sqliteManager.appendMessage(sqliteSession, { role: "user", content: "sqlite", timestamp: Date.now() });
      await sqliteManager.save(sqliteSession);

      const fsLoaded = await fsManager.load(fsSession.id);
      const sqliteLoaded = await sqliteManager.load(sqliteSession.id);

      expect(fsLoaded?.entries).toHaveLength(1);
      expect(sqliteLoaded?.entries).toHaveLength(1);
      expect(fsLoaded?.metadata.userId).toBe("fs-user");
      expect(sqliteLoaded?.metadata.userId).toBe("sqlite-user");

      sqliteStore.close();
    } finally {
      cleanupTempDir(tempDir);
    }
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
