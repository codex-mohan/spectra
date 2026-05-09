import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile, writeFile as fsWriteFile } from "node:fs/promises";
import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { applyEditsToNormalizedContent, detectLineEnding, normalizeToLF, restoreLineEndings, stripBom, generateDiffString } from "../utils/edit-diff.js";
import { withFileMutationQueue } from "../utils/file-mutation-queue.js";
import { resolveToCwd } from "../utils/path.js";
import type { EditOperations, EditToolDetails } from "../types.js";

const defaultEditOperations: EditOperations = {
  readFile: (path) => fsReadFile(path),
  writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
  access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
};

export interface EditToolOptions {
  operations?: EditOperations;
}

export const createEditTool = (cwd: string, options?: EditToolOptions) => {
  const ops = options?.operations ?? defaultEditOperations;

  return defineTool({
    name: "edit",
    label: "Edit",
    description:
      "Edit a file using exact text replacement. Each edit's oldText must match a unique, non-overlapping region of the original file. For multiple changes in one file, use the edits array instead of multiple edit calls.",
    promptGuidelines: [
      "Use edit for precise changes (oldText must match exactly)",
      "For multiple separate changes in one file, use one edit call with multiple entries in edits array",
      "Each edits[].oldText is matched against the original file, not after earlier edits are applied",
      "Keep oldText as small as possible while still being unique in the file",
    ],
    parameters: z.object({
      path: z.string().describe("Path to the file to edit (relative or absolute)"),
      edits: z.array(z.object({
        oldText: z.string().describe("Exact text to find in the file. Must be unique and non-overlapping."),
        newText: z.string().describe("Replacement text"),
      })).describe("Array of text replacements to apply"),
    }),
    execute: async (args, { signal }) => {
      const absolutePath = resolveToCwd(args.path, cwd);

      return withFileMutationQueue(absolutePath, async () => {
        if (signal?.aborted) throw new Error("Operation aborted");

        try {
          await ops.access(absolutePath);
        } catch {
          throw new Error(`File not found: ${args.path}`);
        }

        const buffer = await ops.readFile(absolutePath);
        const rawContent = buffer.toString("utf-8");
        const { bom, text: content } = stripBom(rawContent);
        const originalEnding = detectLineEnding(content);
        const normalizedContent = normalizeToLF(content);

        const { baseContent, newContent } = applyEditsToNormalizedContent(
          normalizedContent,
          args.edits,
          args.path,
        );

        const finalContent = bom + restoreLineEndings(newContent, originalEnding);
        await ops.writeFile(absolutePath, finalContent);

        const diffResult = generateDiffString(baseContent, newContent, args.path);
        const details: EditToolDetails = {
          diff: diffResult.diff,
          firstChangedLine: diffResult.firstChangedLine,
        };

        return {
          content: [{ type: "text" as const, text: `Successfully replaced ${args.edits.length} block(s) in ${args.path}.` }],
          details,
        };
      });
    },
  });
};