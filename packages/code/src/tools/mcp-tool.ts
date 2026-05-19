import { z } from "zod";
import type { AgentTool, ToolResult } from "@singularity-ai/spectra-agent";
import { defineTool } from "@singularity-ai/spectra-agent";
import type { Tool as McpToolDefinition } from "@modelcontextprotocol/sdk/types.js";
import { callMcpTool, formatMcpToolName } from "../services/mcp.js";
import { textResult, errorResult } from "./utils.js";

function mcpSchemaToZod(schema: Record<string, unknown>): z.ZodObject<Record<string, z.ZodType>> {
  const jsonSchema = schema as {
    type?: string;
    properties?: Record<string, {
      type?: string;
      description?: string;
      enum?: unknown[];
      required?: string[];
    }>;
    required?: string[];
  };

  const properties = jsonSchema.properties ?? {};
  const required = jsonSchema.required ?? [];
  const zodShape: Record<string, z.ZodType> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodType;
    const propType = prop.type ?? "string";

    switch (propType) {
      case "string":
        zodType = z.string().describe(prop.description ?? "");
        if (prop.enum) {
          zodType = z.enum(prop.enum as [string, ...string[]]).describe(prop.description ?? "");
        }
        break;
      case "number":
        zodType = z.number().describe(prop.description ?? "");
        break;
      case "integer":
        zodType = z.number().int().describe(prop.description ?? "");
        break;
      case "boolean":
        zodType = z.boolean().describe(prop.description ?? "");
        break;
      case "array":
        zodType = z.array(z.unknown()).describe(prop.description ?? "");
        break;
      case "object":
        zodType = z.record(z.unknown()).describe(prop.description ?? "");
        break;
      default:
        zodType = z.unknown().describe(prop.description ?? "");
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    zodShape[key] = zodType;
  }

  return z.object(zodShape);
}

function extractResultText(result: { content?: unknown[]; isError?: boolean }): ToolResult {
  if (result.isError) {
    const text = result.content
      ?.filter((b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text")
      .map((b) => b.text ?? "")
      .join("\n") || "Tool execution failed";
    return errorResult(text);
  }

  const text = result.content
    ?.filter((b): b is { type: "text"; text: string } => (b as { type?: string }).type === "text")
    .map((b) => b.text ?? "")
    .join("\n") || "(no output)";

  return textResult(text);
}

export function createMcpAgentTool(
  serverName: string,
  mcpTool: McpToolDefinition,
): AgentTool {
  const toolName = formatMcpToolName(serverName, mcpTool.name);
  const inputSchema = (mcpTool.inputSchema as Record<string, unknown>) ?? {};
  const zodSchema = mcpSchemaToZod(inputSchema);

  return defineTool({
    name: toolName,
    description: mcpTool.description ?? `MCP tool from server "${serverName}"`,
    parameters: zodSchema,
    execute: async (args) => {
      try {
        const result = await callMcpTool(serverName, mcpTool.name, args as Record<string, unknown>);
        return extractResultText(result as { content?: unknown[]; isError?: boolean });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return errorResult(`MCP tool "${toolName}" failed: ${message}`);
      }
    },
  });
}

export function createMcpAgentTools(serverName: string, tools: McpToolDefinition[]): AgentTool[] {
  return tools.map((tool) => createMcpAgentTool(serverName, tool));
}
