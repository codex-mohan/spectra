export { createBashTool } from "./bash.js";
export { createReadTool } from "./read.js";
export { createEditTool } from "./edit.js";
export { createWriteTool } from "./write.js";
export { createGrepTool } from "./grep.js";
export { createFindTool } from "./find.js";
export { createLsTool } from "./ls.js";
export { createWebFetchTool } from "./web.js";

import { createBashTool } from "./bash.js";
import { createReadTool } from "./read.js";
import { createEditTool } from "./edit.js";
import { createWriteTool } from "./write.js";
import { createGrepTool } from "./grep.js";
import { createFindTool } from "./find.js";
import { createLsTool } from "./ls.js";
import { createWebFetchTool } from "./web.js";
import type { AgentTool } from "@singularity-ai/spectra-agent";

export function createAllTools(cwd: string): AgentTool[] {
  return [
    createBashTool(cwd),
    createReadTool(cwd),
    createEditTool(cwd),
    createWriteTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
    createWebFetchTool(),
  ];
}