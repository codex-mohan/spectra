import { describe, it, expect } from "vitest";
import { sanitizeToolName, formatMcpToolName } from "../integrations/mcp/client.js";

describe("MCP tool name formatting", () => {
  it("sanitizes tool names", () => {
    expect(sanitizeToolName("hello-world")).toBe("hello_world");
    expect(sanitizeToolName("test.tool")).toBe("test_tool");
    expect(sanitizeToolName("simple")).toBe("simple");
    expect(sanitizeToolName("with spaces")).toBe("with_spaces");
    expect(sanitizeToolName("")).toBe("");
  });

  it("formats combined server+tool names", () => {
    expect(formatMcpToolName("filesystem", "read_file")).toBe("filesystem_read_file");
    expect(formatMcpToolName("my-server", "list-files")).toBe("my_server_list_files");
  });

  it("handles special characters", () => {
    expect(sanitizeToolName("a.b:c/d")).toBe("a_b_c_d");
    expect(formatMcpToolName("server-1", "tool@2")).toBe("server_1_tool_2");
  });
});
