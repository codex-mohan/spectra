import { homedir } from "os";
import { sep, join, resolve } from "path";
import { existsSync, readdirSync, statSync } from "fs";

export function getGlobalConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "spectra");
  const home = homedir();
  if (process.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "spectra");
    return join(home, "AppData", "Roaming", "spectra");
  }
  return join(home, ".config", "spectra");
}

export function getGlobalDataDir(): string {
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "spectra");
  const home = homedir();
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return join(localAppData, "spectra");
    return join(home, "AppData", "Local", "spectra");
  }
  return join(home, ".local", "share", "spectra");
}

export function getGlobalCacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, "spectra");
  const home = homedir();
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return join(localAppData, "spectra", "cache");
    return join(home, "AppData", "Local", "spectra", "cache");
  }
  return join(home, ".cache", "spectra");
}

export interface DiscoveredDir {
  path: string;
  base: string;
}

export function discoverConfigDirs(startDir: string): DiscoveredDir[] {
  const dirs: DiscoveredDir[] = [];
  const global = getGlobalConfigDir();
  if (existsSync(global)) dirs.push({ path: global, base: global });

  const home = homedir();
  const targets = [".spectra", ".opencode", ".claude", ".agents"];

  let current = resolve(startDir);
  const parts = current.split(sep);
  for (let i = parts.length; i >= 1; i--) {
    const dir = parts.slice(0, i).join(sep);
    for (const target of targets) {
      const candidate = join(dir, target);
      if (existsSync(candidate)) {
        if (!dirs.some(d => d.path === candidate)) {
          dirs.push({ path: candidate, base: dir });
        }
      }
    }
    if (dir === home) break;
  }

  const homeDot = join(home, ".spectra");
  if (existsSync(homeDot) && !dirs.some(d => d.path === homeDot)) {
    dirs.push({ path: homeDot, base: home });
  }

  return dirs;
}

export function discoverInstructionFiles(startDir: string): string[] {
  const files: string[] = [];
  const names = ["AGENTS.md", "CLAUDE.md", "SPECTRA.md", "INSTRUCTIONS.md"];

  let current = resolve(startDir);
  const parts = current.split(sep);
  for (let i = parts.length; i >= 1; i--) {
    const dir = parts.slice(0, i).join(sep);
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate) && !files.includes(candidate)) {
        files.push(candidate);
      }
    }
    if (dir === homedir()) break;
  }

  const dirs = discoverConfigDirs(startDir);
  for (const d of dirs) {
    const instructionsDir = join(d.path, "instructions");
    if (existsSync(instructionsDir) && statSync(instructionsDir).isDirectory()) {
      for (const entry of readdirSync(instructionsDir)) {
        if (entry.endsWith(".md")) {
          files.push(join(instructionsDir, entry));
        }
      }
    }
    for (const name of names) {
      const candidate = join(d.path, name);
      if (existsSync(candidate) && !files.includes(candidate)) {
        files.push(candidate);
      }
    }
  }

  return files;
}
