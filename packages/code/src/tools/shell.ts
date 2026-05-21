import { z } from "zod";
import type { SpectraTool } from "./types.js";
import { textResult, errorResult } from "./utils.js";
import { execSync } from "child_process";
import { getPlatformInfo } from "../utils/platform.js";

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
    try {
      const info = getPlatformInfo();
      const stdout = execSync(command, {
        cwd: workdir || process.cwd(),
        timeout: timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, SHELL: info.shell } as NodeJS.ProcessEnv,
        windowsHide: true,
        encoding: "utf-8",
        stdio: "pipe",
      });
      return textResult(`Exit code: 0\n${stdout}`);
    } catch (err: unknown) {
      const error = err as { status?: number; stdout?: string; stderr?: string; message?: string };
      const exitCode = error.status ?? 1;
      const out = error.stdout || "";
      const errOut = error.stderr || "";
      return textResult(`Exit code: ${exitCode}\n${out}${errOut ? `\n${errOut}` : ""}`);
    }
  },
};
