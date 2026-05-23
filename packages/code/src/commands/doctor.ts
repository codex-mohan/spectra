import { execSync } from "child_process";
import { existsSync } from "fs";
import { getGlobalConfigDir, getGlobalDataDir, getGlobalCacheDir } from "../utils/paths.js";
import { getPlatformInfo } from "../utils/platform.js";
import { loadConfig } from "../services/config.js";

export interface DoctorResult {
  checks: DoctorCheck[]
  allPassed: boolean
}

export interface DoctorCheck {
  section: string
  name: string
  passed: boolean
  detail: string
}

export async function runDoctor(): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
  let allPassed = true;

  function ok(section: string, name: string, passed: boolean, detail: string) {
    if (!passed) allPassed = false;
    checks.push({ section, name, passed, detail });
  }

  function tryExec(cmd: string): string {
    try {
      return execSync(cmd, { encoding: "utf-8", timeout: 2000, windowsHide: true }).trim();
    } catch {
      return "";
    }
  }

  const info = getPlatformInfo();
  ok("system", "Platform", true, `${info.os} (${info.arch})`);
  ok("system", "Shell", !!info.shell, `Shell: ${info.shell}`);
  ok("system", "Node/Bun", true, process.version);

  const cwd = process.cwd();
  ok("system", "Working directory", existsSync(cwd), cwd);

  const config = loadConfig(cwd);
  const hasConfig = Object.keys(config).length > 0;
  ok("config", "Config loaded", hasConfig, hasConfig
    ? `model: ${config.model || "(default)"}  provider: ${config.provider || "(auto)"}`
    : "No config file — using defaults");

  const hasKey = !!config.apiKey || !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.SPECTRA_API_KEY;
  ok("config", "API key", hasKey, hasKey ? "Found" : "Set ANTHROPIC_API_KEY or OPENAI_API_KEY");

  const hasRg = !!tryExec("rg --version 2>&1");
  ok("tools", "ripgrep", hasRg, hasRg ? "Available" : "Install for faster grep");

  const hasFd = !!tryExec("fd --version 2>&1");
  ok("tools", "fd", hasFd, hasFd ? "Available" : "Install for faster glob");

  const hasGit = !!tryExec("git --version");
  ok("tools", "git", hasGit, "Available");

  const configDir = getGlobalConfigDir();
  ok("directories", "Config dir", existsSync(configDir), configDir);

  const dataDir = getGlobalDataDir();
  ok("directories", "Data dir", existsSync(dataDir), dataDir);

  const cacheDir = getGlobalCacheDir();
  ok("directories", "Cache dir", existsSync(cacheDir), cacheDir);

  try {
    const { listProviders } = await import("@mohanscodex/spectra-ai");
    const providers = listProviders();
    ok("providers", "Provider registry", providers.length > 0,
      providers.length > 0 ? providers.join(", ") : "No providers registered");
  } catch {
    ok("providers", "Provider registry", false, "Failed to load");
  }

  ok("terminal", "TERM", true, process.env.TERM || process.env.TERMINAL || "unknown");
  ok("terminal", "Size", true, `${process.stdout.columns || "?"}x${process.stdout.rows || "?"}`);

  return { checks, allPassed };
}
