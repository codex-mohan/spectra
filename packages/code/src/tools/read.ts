import { constants } from "node:fs";
import { access as fsAccess, readFile as fsReadFile } from "node:fs/promises";
import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead, formatSize } from "../utils/truncate.js";
import { resolveToCwd } from "../utils/path.js";
import type { ReadOperations, BashToolDetails, ReadToolDetails } from "../types.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function detectImageMimeType(absolutePath: string): string | null {
  const ext = absolutePath.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] ?? null;
}

const defaultReadOperations: ReadOperations = {
  readFile: (path) => fsReadFile(path),
  access: (path) => fsAccess(path, constants.R_OK),
  detectImageMimeType: (path) => Promise.resolve(detectImageMimeType(path)),
};

export interface ReadToolOptions {
  operations?: ReadOperations;
}

export const createReadTool = (cwd: string, options?: ReadToolOptions) => {
  const ops = options?.operations ?? defaultReadOperations;

  return defineTool({
    name: "read",
    label: "Read",
    description: `Read the contents of a file. Supports text files and images (jpg, png, gif, webp). Images are sent as attachments. For text files, output is truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Use offset/limit for large files.`,
    promptGuidelines: [
      "Use read to examine files instead of cat or sed.",
      "For large files, use offset and limit to read in chunks.",
    ],
    parameters: z.object({
      path: z.string().describe("Path to the file to read (relative or absolute)"),
      offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
      limit: z.number().optional().describe("Maximum number of lines to read"),
    }),
    execute: async (args, { signal }) => {
      const absolutePath = resolveToCwd(args.path, cwd);

      if (signal?.aborted) throw new Error("Operation aborted");

      const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : null;

      if (mimeType) {
        const buffer = await ops.readFile(absolutePath);
        const base64 = buffer.toString("base64");
        return {
          content: [
            { type: "text" as const, text: `[Image: ${absolutePath} (${mimeType})]` },
            { type: "image" as const, data: base64, mimeType },
          ],
        };
      }

      const buffer = await ops.readFile(absolutePath);
      const textContent = buffer.toString("utf-8");
      const allLines = textContent.split("\n");
      const totalFileLines = allLines.length;

      const startLine = args.offset ? Math.max(0, args.offset - 1) : 0;
      const startLineDisplay = startLine + 1;

      if (startLine >= allLines.length) {
        throw new Error(`Offset ${args.offset} is beyond end of file (${allLines.length} lines total)`);
      }

      let selectedContent: string;
      let userLimitedLines: number | undefined;

      if (args.limit !== undefined) {
        const endLine = Math.min(startLine + args.limit, allLines.length);
        selectedContent = allLines.slice(startLine, endLine).join("\n");
        userLimitedLines = endLine - startLine;
      } else {
        selectedContent = allLines.slice(startLine).join("\n");
      }

      const truncation = truncateHead(selectedContent);
      const details: ReadToolDetails = {
        truncation: truncation.truncated ? truncation : undefined,
        totalLines: totalFileLines,
        startLine: startLineDisplay,
        endLine: startLineDisplay + truncation.outputLines - 1,
      };

      let outputText: string;

      if (truncation.firstLineExceedsLimit) {
        const firstLineSize = formatSize(Buffer.byteLength(allLines[startLine], "utf-8"));
        outputText = `[Line ${startLineDisplay} is ${firstLineSize}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${startLineDisplay}p' ${args.path} | head -c ${DEFAULT_MAX_BYTES}]`;
      } else if (truncation.truncated) {
        const endLineDisplay = startLineDisplay + truncation.outputLines - 1;
        const nextOffset = endLineDisplay + 1;
        outputText = truncation.content;
        if (truncation.truncatedBy === "lines") {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines}. Use offset=${nextOffset} to continue.]`;
        } else {
          outputText += `\n\n[Showing lines ${startLineDisplay}-${endLineDisplay} of ${totalFileLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
        }
      } else if (userLimitedLines !== undefined && startLine + userLimitedLines < allLines.length) {
        const remaining = allLines.length - (startLine + userLimitedLines);
        const nextOffset = startLine + userLimitedLines + 1;
        outputText = `${truncation.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`;
      } else {
        outputText = truncation.content;
      }

      return { content: [{ type: "text" as const, text: outputText }], details };
    },
  });
};