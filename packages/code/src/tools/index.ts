import type { SpectraTool } from "./types.js";
import { shellTool } from "./shell.js";
import { readTool } from "./read.js";
import { writeTool } from "./write.js";
import { editTool } from "./edit.js";
import { grepTool } from "./grep.js";
import { globTool } from "./glob.js";
import { webFetchTool } from "./web-fetch.js";
import type { AgentTool, ToolResult } from "@singularity-ai/spectra-agent";
import { defineTool } from "@singularity-ai/spectra-agent";
import { textResult } from "./utils.js";

export { type SpectraTool } from "./types.js";

export const builtinTools: SpectraTool[] = [
  shellTool,
  readTool,
  writeTool,
  editTool,
  grepTool,
  globTool,
  webFetchTool,
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

export function getToolDisplayName(tool: SpectraTool, args: unknown, result?: ToolResult): string {
  if (!tool.displayName) return tool.name;
  if (typeof tool.displayName === "string") return tool.displayName;
  return tool.displayName(args, result as ToolResult);
}
