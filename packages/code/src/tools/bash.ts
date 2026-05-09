import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail, formatSize } from "../utils/truncate.js";
import { getShellConfig, getShellEnv, killProcessTree } from "../utils/shell.js";
import type { BashOperations, BashToolDetails } from "../types.js";
import { spawn } from "node:child_process";

function getTempFilePath(): string {
  const id = randomBytes(8).toString("hex");
  return join(tmpdir(), `spectra-bash-${id}.log`);
}

function createLocalBashOperations(): BashOperations {
  return {
    exec: (command, cwd, { onData, signal, timeout, env }) => {
      return new Promise((resolve, reject) => {
        const { shell, args } = getShellConfig();
        const child = spawn(shell, [...args, command], {
          cwd,
          detached: process.platform !== "win32",
          env: env ?? getShellEnv(),
          stdio: ["ignore", "pipe", "pipe"],
        });

        let timedOut = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) killProcessTree(child.pid);
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        const onAbort = () => {
          if (child.pid) killProcessTree(child.pid);
        };
        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        child.on("close", (code) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (signal) signal.removeEventListener("abort", onAbort);
          if (signal?.aborted) {
            reject(new Error("aborted"));
            return;
          }
          if (timedOut) {
            reject(new Error(`timeout:${timeout}`));
            return;
          }
          resolve({ exitCode: code });
        });

        child.on("error", (err) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (signal) signal.removeEventListener("abort", onAbort);
          reject(err);
        });
      });
    },
  };
}

export interface BashToolOptions {
  operations?: BashOperations;
  commandPrefix?: string;
}

export const createBashTool = (cwd: string, options?: BashToolOptions) => {
  const ops = options?.operations ?? createLocalBashOperations();
  const commandPrefix = options?.commandPrefix;

  return defineTool({
    name: "bash",
    label: "Shell",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    promptGuidelines: [
      "Use bash for running commands, installing packages, running tests, git operations, etc.",
      "Prefer bash over read/write for examining file contents when you need context from multiple files.",
    ],
    parameters: z.object({
      command: z.string().describe("Bash command to execute"),
      timeout: z.number().optional().describe("Timeout in seconds (optional, no default timeout)"),
    }),
    execute: async (args, { signal, onUpdate }) => {
      const resolvedCommand = commandPrefix ? `${commandPrefix}\n${args.command}` : args.command;
      const startTime = Date.now();

      let tempFilePath: string | undefined;
      let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
      let totalBytes = 0;
      const chunks: Buffer[] = [];
      let chunksBytes = 0;
      const maxChunksBytes = DEFAULT_MAX_BYTES * 2;

      const ensureTempFile = () => {
        if (tempFilePath) return;
        tempFilePath = getTempFilePath();
        tempFileStream = createWriteStream(tempFilePath);
        for (const chunk of chunks) tempFileStream.write(chunk);
      };

      const handleData = (data: Buffer) => {
        totalBytes += data.length;
        if (totalBytes > DEFAULT_MAX_BYTES) ensureTempFile();
        if (tempFileStream) tempFileStream.write(data);
        chunks.push(data);
        chunksBytes += data.length;
        while (chunksBytes > maxChunksBytes && chunks.length > 1) {
          const removed = chunks.shift()!;
          chunksBytes -= removed.length;
        }
        if (onUpdate) {
          const fullBuffer = Buffer.concat(chunks);
          const fullText = fullBuffer.toString("utf-8");
          const truncation = truncateTail(fullText);
          onUpdate({
            content: [{ type: "text", text: truncation.content || "" }],
            details: {
              truncation: truncation.truncated ? truncation : undefined,
              fullOutputPath: tempFilePath,
              exitCode: null,
              durationMs: Date.now() - startTime,
            },
          });
        }
      };

      try {
const result = await ops.exec(resolvedCommand, cwd, {
        onData: handleData,
        signal,
        timeout: args.timeout,
        env: { ...getShellEnv() },
      });

        const fullBuffer = Buffer.concat(chunks);
        const fullOutput = fullBuffer.toString("utf-8");
        const truncation = truncateTail(fullOutput);
        if (truncation.truncated) ensureTempFile();
        if (tempFileStream) tempFileStream.end();

        let outputText = truncation.content || "(no output)";
        const details: BashToolDetails = {
          truncation: truncation.truncated ? truncation : undefined,
          fullOutputPath: tempFilePath,
          exitCode: result.exitCode,
          durationMs: Date.now() - startTime,
        };

        if (truncation.truncated) {
          const startLine = truncation.totalLines - truncation.outputLines + 1;
          const endLine = truncation.totalLines;
          outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
        }

        if (result.exitCode !== 0 && result.exitCode !== null) {
          return {
            content: [{ type: "text" as const, text: `${outputText}\n\nCommand exited with code ${result.exitCode}` }],
            details,
            isError: true,
          };
        }

        return { content: [{ type: "text" as const, text: outputText }], details };
      } catch (err: unknown) {
        if (tempFileStream) tempFileStream.end();
        const fullBuffer = Buffer.concat(chunks);
        const output = fullBuffer.toString("utf-8");
        const message = err instanceof Error ? err.message : String(err);
        if (message === "aborted") {
          return {
            content: [{ type: "text" as const, text: `${output}\n\nCommand aborted` }],
            details: { exitCode: null, durationMs: Date.now() - startTime },
            isError: true,
          };
        }
        if (message.startsWith("timeout:")) {
          const timeoutSecs = message.split(":")[1];
          return {
            content: [{ type: "text" as const, text: `${output}\n\nCommand timed out after ${timeoutSecs} seconds` }],
            details: { exitCode: null, durationMs: Date.now() - startTime },
            isError: true,
          };
        }
        throw err;
      }
    },
  });
};