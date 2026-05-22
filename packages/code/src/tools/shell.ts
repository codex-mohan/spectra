import { z } from "zod";
import type { SpectraTool } from "./types.js";
import type { ToolResult } from "@singularity-ai/spectra-agent";
import { spawnSync } from "child_process";
import { getPlatformInfo } from "../utils/platform.js";

interface ShellDetails {
  exitCode: number
  stdout: string
  stderr: string
  command: string
}

function formatErrorMessage(message: string, command: string): string {
  const prefix = `Command failed: ${command}\n`;
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length);
  }
  const altPrefix = `Command failed: ${command}\r\n`;
  if (message.startsWith(altPrefix)) {
    return message.slice(altPrefix.length);
  }
  return message;
}

function buildResult(exitCode: number, stdout: string, stderr: string, command: string, errorMessage?: string): ToolResult<ShellDetails> {
  const details: ShellDetails = { exitCode, stdout, stderr, command };
  const parts = [`Exit code: ${exitCode}`];
  if (stdout) parts.push(stdout);
  if (stderr) parts.push(stderr);
  if (!stdout && !stderr && errorMessage) parts.push(formatErrorMessage(errorMessage, command));
  const text = parts.join("\n");
  return {
    content: [{ type: "text", text }],
    details,
    isError: exitCode !== 0,
  };
}

export const shellTool: SpectraTool = {
  name: "bash",
  description: `Execute shell commands on the user's system.
Supports any command available in the system shell.
Returns stdout, stderr, and exit code.
For long-running commands, the output will stream as it becomes available.
Be careful with destructive commands - seek permission for rm -rf, sudo, etc.`,
  displayName: (args: { command: string }) => args.command.split("\n")[0].slice(0, 60),
  parameters: z.object({
    command: z.string().describe("The shell command to execute"),
    description: z.string().optional().describe("Brief description of what this command does"),
    timeout: z.number().optional().describe("Timeout in milliseconds"),
    workdir: z.string().optional().describe("Working directory for the command"),
  }),
  execute: async ({ command, description, timeout, workdir }) => {
    const info = getPlatformInfo();
    const isWindows = info.os === "windows";
    const shell = info.shell;
    const isPwsh = /^pwsh(\.exe)?$/i.test(shell) || /^powershell(\.exe)?$/i.test(shell);

    const result = isPwsh
      ? spawnSync(shell, ["-NoProfile", "-Command", command], {
          cwd: workdir || process.cwd(),
          timeout: timeout || 30000,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          encoding: "utf-8",
        })
      : spawnSync(command, {
          cwd: workdir || process.cwd(),
          timeout: timeout || 30000,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true,
          encoding: "utf-8",
          shell: isWindows ? shell : true,
        });

    if (result.error) {
      const out = (result.stdout || "").toString();
      const errOut = (result.stderr || "").toString();
      const errMsg = result.error.message || "";
      return buildResult(1, out, errOut, command, errMsg);
    }

    const exitCode = result.status ?? 0;
    const out = (result.stdout || "").toString();
    const errOut = (result.stderr || "").toString();
    return buildResult(exitCode, out, errOut, command);
  },
};
