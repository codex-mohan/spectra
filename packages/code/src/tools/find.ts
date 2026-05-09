import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { spawn } from "node:child_process";
import { resolveToCwd } from "../utils/path.js";
import type { FindOperations, FindToolDetails } from "../types.js";

const defaultFindOperations: FindOperations = {
  spawn: (args, cwd, { signal }) => {
    return new Promise((resolve, reject) => {
      const child = spawn("fd", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let stderr = "";

      const onAbort = () => { child.kill("SIGKILL"); };
      if (signal) {
        if (signal.aborted) { child.kill("SIGKILL"); }
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout?.on("data", (data: Buffer) => chunks.push(data));
      child.stderr?.on("data", (data: Buffer) => { stderr += data.toString("utf-8"); });
      child.on("close", (code) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        resolve({ exitCode: code ?? 0, stdout: Buffer.concat(chunks).toString("utf-8"), stderr });
      });
      child.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  },
};

export interface FindToolOptions {
  operations?: FindOperations;
}

export const createFindTool = (cwd: string, options?: FindToolOptions) => {
  const ops = options?.operations ?? defaultFindOperations;

  return defineTool({
    name: "find",
    label: "Find",
    description: "Find files by name pattern. Uses fd for fast file discovery. Respects .gitignore.",
    promptGuidelines: [
      "Use find to locate files by name pattern.",
      "Prefer find over bash for file discovery.",
    ],
    parameters: z.object({
      pattern: z.string().describe("Glob pattern to search for (e.g. '*.ts', '**/test*')"),
      path: z.string().optional().describe("Directory to search in (default: current directory)"),
      limit: z.number().optional().describe("Maximum number of results (default: 1000)"),
    }),
    execute: async (args, { signal }) => {
      const searchPath = args.path ? resolveToCwd(args.path, cwd) : cwd;
      const maxResults = args.limit ?? 1000;

      const fdArgs = ["--glob", "--hidden", "--max-results", String(maxResults)];
      fdArgs.push(args.pattern);
      fdArgs.push(searchPath);

      try {
        const result = await ops.spawn(fdArgs, cwd, { signal });

        if (!result.stdout.trim()) {
          return {
            content: [{ type: "text" as const, text: "No files found matching pattern" }],
            details: { totalFiles: 0 },
          };
        }

        const files = result.stdout.trim().split("\n");
        const output = files.join("\n");
        const truncated = files.length >= maxResults;

        let text = output;
        if (truncated) {
          text += `\n\n[Showing ${maxResults} of many more results. Use a more specific pattern or path.]`;
        }

        return {
          content: [{ type: "text" as const, text }],
          details: { totalFiles: files.length, truncation: truncated ? undefined : undefined },
        };
      } catch (err) {
        if (err instanceof Error && (err.message.includes("ENOENT") || err.message.includes("No such file"))) {
          return {
            content: [{ type: "text" as const, text: `Directory not found: ${args.path}` }],
            details: { totalFiles: 0 },
            isError: true,
          };
        }
        throw err;
      }
    },
  });
};