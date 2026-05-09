import { spawn } from "node:child_process";
import type { ExecException } from "node:child_process";

export interface ShellConfig {
  shell: string;
  args: string[];
}

export function getShellConfig(): ShellConfig {
  if (process.platform === "win32") {
    return { shell: "cmd.exe", args: ["/c"] };
  }
  const shell = process.env.SHELL ?? "/bin/sh";
  return { shell, args: ["-c"] };
}

export function getShellEnv(): NodeJS.ProcessEnv {
  return { ...process.env };
}

export function killProcessTree(pid: number): void {
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Process may have already exited
  }
}

export function waitForChildProcess(child: import("node:child_process").ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    child.on("close", (code: number | null) => resolve(code));
    child.on("error", () => resolve(null));
  });
}