import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { getGlobalConfigDir, discoverConfigDirs, type DiscoveredDir } from "../utils/paths.js";
import { getPlatformInfo } from "../utils/platform.js";

export interface CustomProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  models?: Record<string, { name?: string; contextWindow?: number; maxOutput?: number }>;
  enabled?: boolean;
}

export interface SpectraConfig {
  model?: string;
  smallModel?: string;
  provider?: string;
  apiKey?: string;
  agent?: string;
  agents?: Record<string, AgentConfig>;
  theme?: "dark" | "light";
  mcp?: McpConfig[];
  plugins?: PluginConfig[];
  permissions?: PermissionRule[];
  shell?: string;
  logLevel?: "debug" | "info" | "warn" | "error";
  providers?: Record<string, CustomProviderConfig>;
}

export interface AgentConfig {
  name: string;
  description: string;
  model?: string;
  systemPrompt?: string;
  hidden?: boolean;
  color?: string;
  tools?: string[];
  maxTurns?: number;
}

export interface McpConfig {
  name: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface PluginConfig {
  name: string;
  path?: string;
  enabled?: boolean;
}

export interface PermissionRule {
  name: string;
  pattern: string;
  allow?: boolean;
  timeout?: number;
}

const configFiles = [
  "spectra.json",
  "spectra.jsonc",
  "config.json",
  "opencode.json",
  "opencode.jsonc",
];

export function loadConfig(cwd?: string): SpectraConfig {
  const cfg: SpectraConfig = {};

  const envConfig = process.env.SPECTRA_CONFIG;
  if (envConfig) {
    try {
      const parsed = JSON.parse(envConfig);
      Object.assign(cfg, parsed);
    } catch { }
  }

  const projectDir = cwd || process.cwd();
  const dirs = discoverConfigDirs(projectDir);

  for (const { path: dirPath } of dirs) {
    for (const name of configFiles) {
      const filePath = join(dirPath, name);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(stripJsonc(content));
          Object.assign(cfg, parsed);
        } catch { }
      }
    }
  }

  const globalDir = getGlobalConfigDir();
  if (!dirs.some(d => d.path === globalDir)) {
    for (const name of configFiles) {
      const filePath = join(globalDir, name);
      if (existsSync(filePath)) {
        try {
          const content = readFileSync(filePath, "utf-8");
          const parsed = JSON.parse(stripJsonc(content));
          Object.assign(cfg, parsed);
        } catch { }
      }
    }
  }

  const envProvider = process.env.SPECTRA_PROVIDER;
  const envModel = process.env.SPECTRA_MODEL;
  const envKey = process.env.SPECTRA_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;

  if (envProvider && !cfg.provider) cfg.provider = envProvider;
  if (envModel && !cfg.model) cfg.model = envModel;
  if (envKey && !cfg.apiKey) cfg.apiKey = envKey;

  return cfg;
}

export function saveConfig(cfg: SpectraConfig, filePath?: string): void {
  const target = filePath || join(getGlobalConfigDir(), "spectra.json");
  const dir = target.substring(0, target.lastIndexOf("/") > 0
    ? Math.max(target.lastIndexOf("/"), target.lastIndexOf("\\"))
    : target.lastIndexOf("\\") > 0 ? target.lastIndexOf("\\") : 0);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(target, JSON.stringify(cfg, null, 2));
}


export function getEffectiveModel(cfg: SpectraConfig): string {
  return cfg.model || "anthropic/claude-sonnet-4-20250514";
}

export function getEffectiveProvider(cfg: SpectraConfig): string {
  return cfg.provider || cfg.model?.split("/")[0] || "anthropic";
}

function stripJsonc(text: string): string {
  return text
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim();
}
