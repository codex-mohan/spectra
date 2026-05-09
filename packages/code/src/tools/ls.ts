import { readdir, stat } from "node:fs/promises";
import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { resolveToCwd } from "../utils/path.js";
import type { LsToolDetails } from "../types.js";

export const createLsTool = (cwd: string) => {
  return defineTool({
    name: "ls",
    label: "List",
    description: "List directory contents. Shows file names with / suffix for directories. Alphabetically sorted.",
    promptGuidelines: [
      "Use ls to explore directory structure.",
      "Prefer ls over bash for listing directory contents.",
    ],
    parameters: z.object({
      path: z.string().optional().describe("Directory to list (default: current directory)"),
      limit: z.number().optional().describe("Maximum number of entries (default: 500)"),
    }),
    execute: async (args) => {
      const dirPath = args.path ? resolveToCwd(args.path, cwd) : cwd;
      const limit = args.limit ?? 500;

      try {
        const entries = await readdir(dirPath);
        const results: string[] = [];

        for (const entry of entries.slice(0, limit)) {
          try {
            const fullPath = `${dirPath}/${entry}`;
            const stats = await stat(fullPath);
            results.push(stats.isDirectory() ? `${entry}/` : entry);
          } catch {
            results.push(entry);
          }
        }

        results.sort();
        let output = results.join("\n");

        if (entries.length > limit) {
          output += `\n\n[Showing ${limit} of ${entries.length} entries]`;
        }

        const details: LsToolDetails = {
          totalEntries: entries.length,
        };

        return { content: [{ type: "text" as const, text: output }], details };
      } catch (err) {
        if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            content: [{ type: "text" as const, text: `Directory not found: ${args.path ?? "."}` }],
            details: { totalEntries: 0 },
            isError: true,
          };
        }
        throw err;
      }
    },
  });
};