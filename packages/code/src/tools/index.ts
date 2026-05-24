import type { SpectraTool } from "./types.js";
import { shellTool } from "./shell.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { grepTool } from "./grep.js";
import { globTool } from "./glob.js";
import { webFetchTool } from "./web-fetch.js";
import { taskTool } from "./task.js";
import type { AgentTool, ToolResult } from "@mohanscodex/spectra-agent";
import { defineTool } from "@mohanscodex/spectra-agent";
import { textResult } from "./utils.js";
import { listConnectedServers } from "../integrations/mcp/index.js";
import { createMcpAgentTools } from "./mcp-tool.js";
import { loadCustomTools } from "../integrations/custom-tools/index.js";

export { type SpectraTool } from "./types.js";

export const builtinTools: SpectraTool[] = [
  shellTool,
  readTool,
  writeTool,
  editTool,
  grepTool,
  globTool,
  webFetchTool,
  taskTool,
];

export function spectraToolToAgentTool(specTool: SpectraTool): AgentTool {
  return defineTool({
    name: specTool.name,
    label: typeof specTool.displayName === "string" ? specTool.displayName : undefined,
    description: specTool.description,
    parameters: specTool.parameters,
    promptGuidelines: specTool.promptGuidelines,
    execute: async (args, ctx) => {
      return specTool.execute(args, ctx);
    },
  });
}

export function createAllTools(): SpectraTool[] {
  return [...builtinTools];
}

export async function createAllToolsWithMcp(): Promise<{
  builtin: AgentTool[];
  mcp: AgentTool[];
  all: AgentTool[];
}> {
  const builtin = builtinTools.map(spectraToolToAgentTool);

  const connected = listConnectedServers();
  const mcp: AgentTool[] = [];
  for (const server of connected) {
    if (server.tools.length > 0) {
      mcp.push(...createMcpAgentTools(server.name, server.tools));
    }
  }

  return {
    builtin,
    mcp,
    all: [...builtin, ...mcp],
  };
}

export function getToolStats(): { builtin: number; mcp: number; total: number } {
  const connected = listConnectedServers();
  const mcpCount = connected.reduce((sum, s) => sum + s.tools.length, 0);
  return {
    builtin: builtinTools.length,
    mcp: mcpCount,
    total: builtinTools.length + mcpCount,
  };
}

export async function createAllToolsWithExtensions(): Promise<{
  builtin: AgentTool[];
  mcp: AgentTool[];
  custom: AgentTool[];
  all: AgentTool[];
}> {
  const builtin = builtinTools.map(spectraToolToAgentTool);

  const connected = listConnectedServers();
  const mcp: AgentTool[] = [];
  for (const server of connected) {
    if (server.tools.length > 0) {
      mcp.push(...createMcpAgentTools(server.name, server.tools));
    }
  }

  const custom = await loadCustomTools(process.cwd());

  return {
    builtin,
    mcp,
    custom,
    all: [...builtin, ...mcp, ...custom],
  };
}

export function getToolDisplayName(tool: SpectraTool, args: unknown, result?: ToolResult): string {
  if (!tool.displayName) return tool.name;
  if (typeof tool.displayName === "string") return tool.displayName;
  return tool.displayName(args, result as ToolResult);
}
