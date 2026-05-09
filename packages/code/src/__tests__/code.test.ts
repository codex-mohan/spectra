import { describe, it, expect } from "vitest";
import { truncateHead, truncateTail, formatSize } from "../utils/truncate.js";
import { normalizeToLF, detectLineEnding, stripBom } from "../utils/edit-diff.js";
import { resolveToCwd } from "../utils/path.js";

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