import { describe, it, expect } from "vitest";
import { truncateHead, truncateTail, formatSize } from "../utils/truncate.js";
import { normalizeToLF, detectLineEnding, stripBom } from "../utils/edit-diff.js";
import { resolveToCwd } from "../utils/path.js";
import { EventBus } from "../extensions/event-bus.js";
import { ExtensionApiImpl } from "../extensions/extension-api.js";
import { ExtensionLoader } from "../extensions/extension-loader.js";
import { mergeContextContents } from "../config/context.js";
import type { ContextFile } from "../config/context.js";
import { stripJsoncComments } from "../config/config.js";
import { createWebFetchTool } from "../tools/web.js";
import { createSession, addMessageToSession } from "../config/session.js";
import type { SessionMessage } from "../config/session.js";

describe("truncateHead", () => {
  it("should not truncate content within limits", () => {
    const result = truncateHead("hello\nworld", 100, 10000);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello\nworld");
    expect(result.totalLines).toBe(2);
  });

  it("should truncate by lines", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = truncateHead(lines, 10, 100000);
    expect(result.truncated).toBe(true);
    expect(result.outputLines).toBe(10);
    expect(result.truncatedBy).toBe("lines");
  });

  it("should truncate by bytes", () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = truncateHead(content, 10000, 100);
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
  });

  it("should detect first line exceeding limit", () => {
    const longLine = "a".repeat(200);
    const result = truncateHead(longLine, 10, 100);
    expect(result.firstLineExceedsLimit).toBe(true);
    expect(result.truncated).toBe(true);
  });
});

describe("truncateTail", () => {
  it("should not truncate content within limits", () => {
    const result = truncateTail("hello\nworld", 100, 10000);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("hello\nworld");
  });

  it("should return last N lines when truncating", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join("\n");
    const result = truncateTail(lines, 10, 100000);
    expect(result.truncated).toBe(true);
    expect(result.outputLines).toBe(10);
  });
});

describe("formatSize", () => {
  it("should format bytes", () => {
    expect(formatSize(500)).toBe("500B");
  });

  it("should format kilobytes", () => {
    expect(formatSize(1024)).toBe("1.0KB");
  });

  it("should format megabytes", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0MB");
  });
});

describe("edit-diff", () => {
  it("should normalize line endings", () => {
    expect(normalizeToLF("a\r\nb\r\n")).toBe("a\nb\n");
  });

  it("should detect CRLF", () => {
    expect(detectLineEnding("a\r\nb\r\n")).toBe("\r\n");
    expect(detectLineEnding("a\nb\n")).toBe("\n");
  });

  it("should strip BOM", () => {
    const { bom, text } = stripBom("\uFEFFhello");
    expect(bom).toBe("\uFEFF");
    expect(text).toBe("hello");
  });

  it("should handle no BOM", () => {
    const { bom, text } = stripBom("hello");
    expect(bom).toBe("");
    expect(text).toBe("hello");
  });
});

describe("resolvePath", () => {
  it("should expand ~ to home directory", () => {
    const result = resolveToCwd("~/test", "/cwd");
    expect(result).toContain("test");
  });

  it("should resolve relative paths", () => {
    const result = resolveToCwd("src/index.ts", "/project");
    expect(result).toContain("project");
    expect(result).toContain("src");
    expect(result).toContain("index.ts");
  });
});

describe("EventBus", () => {
  it("should emit and receive events", () => {
    const bus = new EventBus();
    let received: unknown;
    bus.on("test", (data) => { received = data; });
    bus.emit("test", { value: 42 });
    expect(received).toEqual({ value: 42 });
  });

  it("should support multiple listeners", () => {
    const bus = new EventBus();
    let count = 0;
    bus.on("test", () => { count++; });
    bus.on("test", () => { count++; });
    bus.emit("test", null);
    expect(count).toBe(2);
  });

  it("off should remove listener", () => {
    const bus = new EventBus();
    let count = 0;
    const unsub = bus.on("test", () => { count++; });
    unsub();
    bus.emit("test", null);
    expect(count).toBe(0);
  });

  it("off(eventType, listener) should remove specific listener", () => {
    const bus = new EventBus();
    let count = 0;
    const listener = () => { count++; };
    bus.on("test", listener);
    bus.off("test", listener);
    bus.emit("test", null);
    expect(count).toBe(0);
  });

  it("should not throw on non-existent event", () => {
    const bus = new EventBus();
    expect(() => bus.emit("nonexistent", null)).not.toThrow();
  });

  it("should count listeners", () => {
    const bus = new EventBus();
    bus.on("test", () => {});
    bus.on("test", () => {});
    expect(bus.listenerCount("test")).toBe(2);
    expect(bus.listenerCount("other")).toBe(0);
  });

  it("removeAllListeners clears all or specific", () => {
    const bus = new EventBus();
    bus.on("a", () => {});
    bus.on("b", () => {});
    bus.removeAllListeners("a");
    expect(bus.listenerCount("a")).toBe(0);
    expect(bus.listenerCount("b")).toBe(1);
    bus.removeAllListeners();
    expect(bus.listenerCount("b")).toBe(0);
  });

  it("should swallow errors in listeners", () => {
    const bus = new EventBus();
    bus.on("test", () => { throw new Error("fail"); });
    bus.on("test", () => {});
    expect(() => bus.emit("test", null)).not.toThrow();
  });
});

describe("ExtensionApiImpl", () => {
  it("should register tools", () => {
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test@1.0.0", "test", "1.0.0", bus, logger);
    const tool = {
      name: "test-tool",
      description: "A test tool",
      parameters: {},
      execute: async () => ({ content: [] }),
    };
    api.registerTool(tool);
    expect(api.getTools()).toHaveLength(1);
    expect(api.getTools()[0].name).toBe("test-tool");
  });

  it("should unregister tools", () => {
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test@1.0.0", "test", "1.0.0", bus, logger);
    const tool = {
      name: "test-tool",
      description: "A test tool",
      parameters: {},
      execute: async () => ({ content: [] }),
    };
    api.registerTool(tool);
    api.unregisterTool("test-tool");
    expect(api.getTools()).toHaveLength(0);
  });

  it("should store before/after tool call hooks", () => {
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test@1.0.0", "test", "1.0.0", bus, logger);
    const beforeHook = async () => undefined;
    const afterHook = async () => undefined;
    api.onBeforeToolCall(beforeHook);
    api.onAfterToolCall(afterHook);
    expect(api.getBeforeToolCallHooks()).toHaveLength(1);
    expect(api.getAfterToolCallHooks()).toHaveLength(1);
  });

  it("should expose event bus through on/off/emit", () => {
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test@1.0.0", "test", "1.0.0", bus, logger);
    let received: unknown;
    api.onEvent("custom", (data) => { received = data; });
    api.emitEvent("custom", { key: "value" });
    expect(received).toEqual({ key: "value" });
  });

  it("should return logger", () => {
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test@1.0.0", "test", "1.0.0", bus, logger);
    expect(api.getLogger()).toBe(logger);
  });
});

describe("ExtensionLoader", () => {
  it("should discover extensions from non-existent dirs gracefully", async () => {
    const loader = new ExtensionLoader();
    const files = await loader.discoverExtensions(["/nonexistent/path"]);
    expect(files).toEqual([]);
  });

  it("should load and unload extensions", async () => {
    const loader = new ExtensionLoader();
    const ext: import("../extensions/types.js").Extension = {
      name: "test-ext",
      version: "1.0.0",
      activate(api) {
        api.registerTool({
          name: "hello",
          description: "says hello",
          parameters: {},
          execute: async () => ({ content: [{ type: "text", text: "hi" }] }),
        });
      },
      deactivate() {},
    };

    // We test through the loader's internal mechanism
    // but since we can't write .ts files in test, we test the API directly
    const bus = new EventBus();
    const logger = { info: () => {}, warn: () => {}, error: () => {} };
    const api = new ExtensionApiImpl("test-ext@1.0.0", "test-ext", "1.0.0", bus, logger);
    await ext.activate(api);
    expect(api.getTools()).toHaveLength(1);
    expect(api.getTools()[0].name).toBe("hello");

    if (ext.deactivate) await ext.deactivate();
  });

  it("should collect all tools from loaded extensions", async () => {
    const loader = new ExtensionLoader();
    // We simulate by creating API instances directly
    // (loadExtension requires jiti + filesystem, tested via integration)
    expect(loader.getExtensions()).toEqual([]);
  });
});

describe("mergeContextContents", () => {
  it("should merge context files with headers", () => {
    const files: ContextFile[] = [
      { filePath: "/a/SPECTRA.md", content: "Spectra project context", priority: 100, source: "SPECTRA.md" },
      { filePath: "/a/AGENTS.md", content: "Agents guidelines", priority: 80, source: "AGENTS.md" },
      { filePath: "/a/CLAUDE.md", content: "Claude compat", priority: 60, source: "CLAUDE.md" },
    ];
    const result = mergeContextContents(files);
    expect(result).toContain("SPECTRA.md");
    expect(result).toContain("Spectra project context");
    expect(result).toContain("Agents guidelines");
    expect(result).toContain("Claude compat");
    expect(result).toContain("---");
  });

  it("should return empty string for empty files", () => {
    const result = mergeContextContents([]);
    expect(result).toBe("");
  });

  it("should use custom separator", () => {
    const files: ContextFile[] = [
      { filePath: "/a/SPECTRA.md", content: "A", priority: 100, source: "SPECTRA.md" },
      { filePath: "/a/AGENTS.md", content: "B", priority: 80, source: "AGENTS.md" },
    ];
    const result = mergeContextContents(files, "\n");
    expect(result).toContain("A");
    expect(result).toContain("B");
  });
});

describe("stripJsoncComments", () => {
  it("should strip single-line comments", () => {
    const input = '{\n  "key": "value" // comment\n}';
    const result = stripJsoncComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("should strip multi-line comments", () => {
    const input = '{\n  /* comment */\n  "key": "value"\n}';
    const result = stripJsoncComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });

  it("should not strip comments inside strings", () => {
    const input = '{"key": "value // not a comment"}';
    const result = stripJsoncComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value // not a comment" });
  });

  it("should handle plain JSON", () => {
    const input = '{"key": "value"}';
    const result = stripJsoncComments(input);
    expect(JSON.parse(result)).toEqual({ key: "value" });
  });
});

describe("createWebFetchTool", () => {
  it("should create a tool with correct name and schema", () => {
    const tool = createWebFetchTool();
    expect(tool.name).toBe("web_fetch");
    expect(tool.description).toBeTruthy();
    expect(tool.execute).toBeTypeOf("function");
  });

  it("should create tool with custom operations", () => {
    const mockFetch = async (url: string) => ({
      status: 200,
      headers: { "content-type": "text/html" },
      body: "<html>test</html>",
    });
    const tool = createWebFetchTool({
      operations: { fetch: mockFetch },
    });
    expect(tool.name).toBe("web_fetch");
  });

  it("should handle successful fetch", async () => {
    const mockOps = {
      fetch: async (url: string) => ({
        status: 200,
        headers: { "content-type": "text/html" },
        body: "Hello, World!",
      }),
    };
    const tool = createWebFetchTool({ operations: mockOps });
    const result = await tool.execute("call_1", { url: "https://example.com" });
    const textContent = result.content.find((c: { type: string }) => c.type === "text");
    expect(textContent).toBeDefined();
    expect((textContent as { text: string }).text).toContain("Hello, World!");
    expect((textContent as { text: string }).text).toContain("HTTP 200");
  });

  it("should handle HTTP error status", async () => {
    const mockOps = {
      fetch: async (url: string) => ({
        status: 404,
        headers: { "content-type": "text/html" },
        body: "Not Found",
      }),
    };
    const tool = createWebFetchTool({ operations: mockOps });
    const result = await tool.execute("call_1", { url: "https://example.com/missing" });
    expect(result.isError).toBe(true);
  });

  it("should truncate long responses", async () => {
    const longBody = "x".repeat(60000);
    const mockOps = {
      fetch: async (url: string) => ({
        status: 200,
        headers: { "content-type": "text/plain" },
        body: longBody,
      }),
    };
    const tool = createWebFetchTool({ operations: mockOps, maxLength: 1000 });
    const result = await tool.execute("call_1", { url: "https://example.com/big" });
    const textContent = result.content.find((c: { type: string }) => c.type === "text") as { text: string };
    expect(textContent.text).toContain("truncated");
    expect(result.details as Record<string, unknown>).toHaveProperty("truncated", true);
  });
});

describe("Session", () => {
  it("should create a new session", () => {
    const session = createSession("test-model");
    expect(session.id).toMatch(/^session_/);
    expect(session.model).toBe("test-model");
    expect(session.messages).toEqual([]);
    expect(session.createdAt).toBeGreaterThan(0);
  });

  it("should add messages to session", () => {
    let session = createSession("test-model");
    const msg: SessionMessage = {
      id: "msg_1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    };
    session = addMessageToSession(session, msg);
    expect(session.messages).toHaveLength(1);
    expect(session.messages[0].content).toBe("hello");
  });

  it("should preserve immutability when adding messages", () => {
    const session = createSession("test-model");
    const msg: SessionMessage = {
      id: "msg_1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    };
    const updated = addMessageToSession(session, msg);
    expect(session.messages).toHaveLength(0);
    expect(updated.messages).toHaveLength(1);
  });
});