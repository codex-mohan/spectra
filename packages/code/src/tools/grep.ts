import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { spawn } from "node:child_process";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, truncateLine } from "../utils/truncate.js";
import { resolveToCwd } from "../utils/path.js";
import type { GrepOperations, GrepToolDetails } from "../types.js";

const defaultGrepOperations: GrepOperations = {
  spawn: (args, cwd, { signal }) => {
    return new Promise((resolve, reject) => {
      const child = spawn("rg", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = [];
      let stderr = "";

      const onAbort = () => {
        child.kill("SIGKILL");
      };
      if (signal) {
        if (signal.aborted) { child.kill("SIGKILL"); }
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      child.stdout?.on("data", (data: Buffer) => chunks.push(data));
      child.stderr?.on("data", (data: Buffer) => { stderr += data.toString("utf-8"); });

      child.on("close", (code) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        const stdout = Buffer.concat(chunks).toString("utf-8");
        resolve({ exitCode: code ?? 0, stdout, stderr });
      });
      child.on("error", (err) => {
        if (signal) signal.removeEventListener("abort", onAbort);
        reject(err);
      });
    });
  },
};

export interface GrepToolOptions {
  operations?: GrepOperations;
}

export const createGrepTool = (cwd: string, options?: GrepToolOptions) => {
  const ops = options?.operations ?? defaultGrepOperations;

  return defineTool({
    name: "grep",
    label: "Grep",
    description: `Search file contents using ripgrep. Supports regex patterns. Results are truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB.`,
    promptGuidelines: [
      "Use grep to search for patterns in code files.",
      "Prefer grep over bash for searching file contents.",
    ],
    parameters: z.object({
      pattern: z.string().describe("Search pattern (regex or literal string)"),
      path: z.string().optional().describe("Directory or file to search (default: current directory)"),
      glob: z.string().optional().describe("Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'"),
      ignoreCase: z.boolean().optional().describe("Case-insensitive search"),
      literal: z.boolean().optional().describe("Treat pattern as literal string"),
      context: z.number().optional().describe("Number of context lines around matches (default: 2)"),
      limit: z.number().optional().describe("Maximum number of results"),
    }),
    execute: async (args, { signal }) => {
      const searchPath = args.path ? resolveToCwd(args.path, cwd) : cwd;
      const rgArgs: string[] = ["--json"];

      if (args.ignoreCase) rgArgs.push("-i");
      if (args.literal) rgArgs.push("--fixed-strings");
      if (args.context !== undefined) rgArgs.push("-C", String(args.context));
      if (args.glob) rgArgs.push("--glob", args.glob);

      rgArgs.push("--max-count", String(args.limit ?? DEFAULT_MAX_LINES));
      rgArgs.push(args.pattern);
      rgArgs.push(searchPath);

      try {
        const result = await ops.spawn(rgArgs, cwd, { signal });

        if (!result.stdout.trim()) {
          const message = result.exitCode === 0 ? "No matches found" : result.stderr || "grep failed";
          return {
            content: [{ type: "text" as const, text: message }],
            details: { matchCount: 0 },
          };
        }

        const lines: string[] = [];
        let matchCount = 0;
        for (const line of result.stdout.split("\n")) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line);
            if (entry.type === "match") {
              matchCount++;
              const filePath = entry.data?.path?.text ?? "";
              const lineNum = entry.data?.line_number ?? 0;
              const text = entry.data?.lines?.text ?? "";
              lines.push(`${filePath}:${lineNum}:${truncateLine(text)}`);
            } else if (entry.type === "context") {
              const filePath = entry.data?.path?.text ?? "";
              const lineNum = entry.data?.line_number ?? 0;
              const text = entry.data?.lines?.text ?? "";
              lines.push(`${filePath}-${lineNum}:${truncateLine(text)}`);
            }
          } catch {
            lines.push(truncateLine(line));
          }
        }

        const output = lines.join("\n");
        const truncation = truncateHead(output);
        const details: GrepToolDetails = {
          truncation: truncation.truncated ? truncation : undefined,
          matchCount,
        };

        let text = truncation.content;
        if (truncation.truncated) {
          const startLine = 1;
          const endLine = truncation.outputLines;
          text += `\n\n[Showing ${matchCount} matches, lines ${startLine}-${endLine} of ${truncation.totalLines} total.]`;
        }

        return { content: [{ type: "text" as const, text }], details };
      } catch (err) {
        if (err instanceof Error && err.message.includes("No such file")) {
          return {
            content: [{ type: "text" as const, text: `Directory not found: ${args.path}` }],
            details: { matchCount: 0 },
            isError: true,
          };
        }
        throw err;
      }
    },
  });
};