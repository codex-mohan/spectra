import type { CommandModule } from "yargs";
import { execSync } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { getGlobalConfigDir, getGlobalDataDir, getGlobalCacheDir, discoverConfigDirs, discoverInstructionFiles } from "../utils/paths.js";
import { getPlatformInfo } from "../utils/platform.js";
import { loadConfig } from "../services/config.js";
import { listProviders } from "@mohanscodex/spectra-ai";

export const doctorCommand: CommandModule = {
  command: "doctor",
  describe: "Run system health checks",
  handler: () => {
    let allPassed = true;

    function check(name: string, ok: boolean, detail?: string) {
      process.stdout.write(`${ok ? "✓" : "✗"} ${name}\n`);
      if (!ok) allPassed = false;
      if (detail) process.stdout.write(`  ${detail}\n`);
    }

    function tryExec(cmd: string): string {
      try {
        return execSync(cmd, { encoding: "utf-8", timeout: 2000, windowsHide: true }).trim();
      } catch {
        return "";
      }
    }

    process.stdout.write("Spectra Code — System Health Check\n\n");
    process.stdout.write("[system]\n");

    const info = getPlatformInfo();
    check("Platform", true, `${info.os} (${info.arch})`);
    check("Shell", !!info.shell, `Shell: ${info.shell}`);
    check("Node/Bun", true, `${process.version}`);

    const cwd = process.cwd();
    check("Working directory", existsSync(cwd), cwd);

    process.stdout.write("\n[config]\n");
    const config = loadConfig(cwd);
    const hasConfig = Object.keys(config).length > 0;
    check("Config loaded", hasConfig, hasConfig ? JSON.stringify({
      model: config.model || "(default)",
      provider: config.provider || "(auto)",
      agent: config.agent || "(default)",
      logLevel: config.logLevel || "info",
    }) : "Using defaults — no config file found");

    const hasKey = !!config.apiKey || !!process.env.ANTHROPIC_API_KEY || !!process.env.OPENAI_API_KEY || !!process.env.SPECTRA_API_KEY;
    check("API key", hasKey, hasKey ? "Found" : "Not configured — set ANTHROPIC_API_KEY, OPENAI_API_KEY, or SPECTRA_API_KEY");

    process.stdout.write("\n[providers]\n");
    const providers = listProviders();
    check("Provider registry", providers.length > 0,
      providers.length > 0 ? `Registered: ${providers.join(", ")}` : "No providers registered — run initProviders()");

    process.stdout.write("\n[tools]\n");
    const hasRg = tryExec('rg --version 2>/dev/null; if ($?) { where rg 2>nul }') || tryExec('rg --version');
    check("ripgrep", !!hasRg, hasRg?.split("\n")[0] || "Not found — install ripgrep for faster search");
    const hasFd = tryExec('fd --version 2>/dev/null') || tryExec('fdfind --version');
    check("fd", !!hasFd, hasFd?.split("\n")[0] || "Not found — install fd for faster file globbing");
    const hasGit = tryExec('git --version');
    check("git", !!hasGit, hasGit?.split("\n")[0] || "Not found");

    process.stdout.write("\n[directories]\n");
    const configDir = getGlobalConfigDir();
    check("Config dir", existsSync(configDir), configDir);
    if (!existsSync(configDir)) {
      try { mkdirSync(configDir, { recursive: true }); process.stdout.write("  Created\n"); } catch { }
    }
    const dataDir = getGlobalDataDir();
    check("Data dir", existsSync(dataDir), dataDir);
    if (!existsSync(dataDir)) {
      try { mkdirSync(dataDir, { recursive: true }); process.stdout.write("  Created\n"); } catch { }
    }
    const cacheDir = getGlobalCacheDir();
    check("Cache dir", existsSync(cacheDir), cacheDir);
    if (!existsSync(cacheDir)) {
      try { mkdirSync(cacheDir, { recursive: true }); } catch { }
    }

    process.stdout.write("\n[discovery]\n");
    const dirs = discoverConfigDirs(cwd);
    check("Config dirs found", dirs.length > 0,
      dirs.length > 0 ? dirs.map(d => d.path).join(", ") : "None found");
    const instrFiles = discoverInstructionFiles(cwd);
    check("Instruction files", instrFiles.length > 0,
      instrFiles.length > 0 ? instrFiles.join(", ") : "None found");

    process.stdout.write("\n[terminal]\n");
    const term = process.env.TERM || process.env.TERMINAL || "unknown";
    check("TERM", true, term);
    const rows = process.stdout.rows;
    const cols = process.stdout.columns;
    check("Size", true, `${cols}x${rows}`);

    process.stdout.write(`\n${allPassed ? "✓ All checks passed." : "✗ Some checks failed — review the items above."}\n`);
    process.exit(allPassed ? 0 : 1);
  },
};
