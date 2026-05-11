import { readFile, stat } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

export interface SpectraConfig {
  model?: string;
  apiKey?: string;
  apiBaseUrl?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  tools?: {
    enabled?: string[];
    disabled?: string[];
  };
  extensions?: {
    dirs?: string[];
    enabled?: string[];
    disabled?: string[];
  };
  context?: ContextConfig;
  session?: SessionConfig;
}

export interface ContextConfig {
  files?: string[];
  priorities?: Record<string, number>;
  maxLength?: number;
}

export interface SessionConfig {
  dir?: string;
  format?: "jsonl" | "json";
  maxHistoryTurns?: number;
}

const DEFAULT_CONFIG_FILES = [
  ".spectra/config.json",
  ".spectra/config.jsonc",
  ".spectra/config.yaml",
];

const COMPAT_CONFIG_DIRS = [".opencode", ".pi", ".claude"];

const COMPAT_CONFIG_FILES = [
  ".opencode/config.json",
  ".pi/config.json",
  ".claude/config.json",
];

export async function discoverConfigDir(cwd: string = process.cwd()): Promise<string | null> {
  const dotSpectra = join(cwd, ".spectra");
  try {
    const st = await stat(dotSpectra);
    if (st.isDirectory()) return dotSpectra;
  } catch { /* not found */ }

  for (const dir of COMPAT_CONFIG_DIRS) {
    const compatDir = join(cwd, dir);
    try {
      const st = await stat(compatDir);
      if (st.isDirectory()) return compatDir;
    } catch { /* not found */ }
  }

  return null;
}

export async function loadConfig(cwd: string = process.cwd()): Promise<SpectraConfig> {
  const config: SpectraConfig = {};

  for (const configPath of COMPAT_CONFIG_FILES) {
    const fullPath = join(cwd, configPath);
    if (existsSync(fullPath)) {
      try {
        const raw = await readFile(fullPath, "utf-8");
        const parsed = JSON.parse(stripJsoncComments(raw));
        Object.assign(config, parsed);
        break;
      } catch { /* skip invalid */ }
    }
  }

  for (const configPath of DEFAULT_CONFIG_FILES) {
    const fullPath = join(cwd, configPath);
    if (existsSync(fullPath)) {
      try {
        const raw = await readFile(fullPath, "utf-8");
        const parsed = JSON.parse(stripJsoncComments(raw));
        Object.assign(config, parsed);
        break;
      } catch { /* skip invalid */ }
    }
  }

  return config;
}

export function resolveConfigPath(cwd: string, configDir: string): {
  extensionsDir: string;
  sessionsDir: string;
  contextDir: string;
} {
  return {
    extensionsDir: join(configDir, "extensions"),
    sessionsDir: join(configDir, "sessions"),
    contextDir: join(configDir, "context"),
  };
}

export function stripJsoncComments(str: string): string {
  let result = "";
  let i = 0;
  let inString = false;
  let stringChar = "";

  while (i < str.length) {
    if (!inString) {
      if (str[i] === '"' || str[i] === "'") {
        inString = true;
        stringChar = str[i];
        result += str[i++];
      } else if (str[i] === "/" && str[i + 1] === "/") {
        while (i < str.length && str[i] !== "\n") i++;
      } else if (str[i] === "/" && str[i + 1] === "*") {
        i += 2;
        while (i < str.length && !(str[i] === "*" && str[i + 1] === "/")) i++;
        i += 2;
      } else {
        result += str[i++];
      }
    } else {
      if (str[i] === "\\" && i + 1 < str.length) {
        result += str[i++];
        result += str[i++];
      } else if (str[i] === stringChar) {
        inString = false;
        result += str[i++];
      } else {
        result += str[i++];
      }
    }
  }
  return result;
}