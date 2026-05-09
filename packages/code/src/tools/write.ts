import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { withFileMutationQueue } from "../utils/file-mutation-queue.js";
import { resolveToCwd } from "../utils/path.js";
import type { WriteOperations } from "../types.js";

const defaultWriteOperations: WriteOperations = {
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
  operations?: WriteOperations;
}

export const createWriteTool = (cwd: string, options?: WriteToolOptions) => {
  const ops = options?.operations ?? defaultWriteOperations;

  return defineTool({
    name: "write",
    label: "Write",
    description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    promptGuidelines: [
      "Use write only for new files or complete rewrites.",
      "For small changes to existing files, prefer edit instead of write.",
    ],
    parameters: z.object({
      path: z.string().describe("Path to the file to write (relative or absolute)"),
      content: z.string().describe("Content to write to the file"),
    }),
    execute: async (args, { signal }) => {
      const absolutePath = resolveToCwd(args.path, cwd);
      const dir = dirname(absolutePath);

      return withFileMutationQueue(absolutePath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted");

        await ops.mkdir(dir);
        if (signal?.aborted) throw new Error("Operation aborted");

        await ops.writeFile(absolutePath, args.content);

        return {
          content: [{ type: "text" as const, text: `Successfully wrote ${args.content.length} bytes to ${args.path}` }],
        };
      });
    },
  });
};