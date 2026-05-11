import { extname, join, basename } from "node:path";
import { stat, readdir } from "node:fs/promises";
import type { Extension, ResolvedExtension } from "./types.js";
import { ExtensionApiImpl } from "./extension-api.js";
import { EventBus } from "./event-bus.js";

export type ExtensionLoaderLogger = {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
};

const DEFAULT_LOGGER: ExtensionLoaderLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
};

export class ExtensionLoader {
  private extensions = new Map<string, ResolvedExtension>();
  private bus = new EventBus();
  private logger: ExtensionLoaderLogger;
  private jiti: { import: (id: string) => Promise<unknown> } | null = null;

  private apis = new Map<string, ExtensionApiImpl>();

  constructor(logger?: ExtensionLoaderLogger) {
    this.logger = logger ?? DEFAULT_LOGGER;
  }

  async discoverExtensions(dirs: string[]): Promise<string[]> {
    const discovered: string[] = [];
    for (const dir of dirs) {
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) continue;
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const indexPaths = [
              join(dir, entry.name, "index.ts"),
              join(dir, entry.name, "index.js"),
              join(dir, entry.name, "index.mjs"),
            ];
            for (const p of indexPaths) {
              try {
                await stat(p);
                discovered.push(p);
                break;
              } catch { /* not found */ }
            }
          } else if (entry.isFile()) {
            const ext = extname(entry.name);
            if (ext === ".ts" || ext === ".js" || ext === ".mjs") {
              discovered.push(join(dir, entry.name));
            }
          }
        }
      } catch {
        // directory doesn't exist, skip
      }
    }
    return discovered;
  }

  async loadExtension(filePath: string): Promise<ResolvedExtension> {
    const jiti = await this.getJiti();
    const mod = await jiti.import(filePath) as Record<string, unknown> | { default: Record<string, unknown> };
    const raw = ("default" in mod && typeof mod.default === "object" && mod.default !== null) ? mod.default : mod;
    const extension = raw as unknown as Extension;

    if (!extension || typeof extension.activate !== "function") {
      throw new Error(`Extension at ${filePath} does not export a valid Extension (missing activate function)`);
    }

    const name = extension.name || basename(filePath, extname(filePath));
    const version = extension.version || "0.0.0";
    const id = `${name}@${version}`;

    const api = new ExtensionApiImpl(id, name, version, this.bus, this.logger);
    await extension.activate(api);
    this.apis.set(id, api);

    const resolved: ResolvedExtension = {
      id,
      name,
      version,
      filePath,
      extension,
    };

    this.extensions.set(id, resolved);
    this.logger.info(`Loaded extension: ${id}`);
    return resolved;
  }

  async loadFromDirs(dirs: string[]): Promise<ResolvedExtension[]> {
    const filePaths = await this.discoverExtensions(dirs);
    const loaded: ResolvedExtension[] = [];
    for (const filePath of filePaths) {
      try {
        const resolved = await this.loadExtension(filePath);
        loaded.push(resolved);
      } catch (err) {
        this.logger.error(`Failed to load extension from ${filePath}: ${err}`);
      }
    }
    return loaded;
  }

  async unloadExtension(id: string): Promise<void> {
    const resolved = this.extensions.get(id);
    if (!resolved) return;
    if (resolved.extension.deactivate) {
      await resolved.extension.deactivate();
    }
    this.apis.delete(id);
    this.extensions.delete(id);
  }

  async unloadAll(): Promise<void> {
    for (const id of Array.from(this.extensions.keys())) {
      await this.unloadExtension(id);
    }
  }

  getExtensions(): ResolvedExtension[] {
    return Array.from(this.extensions.values());
  }

  getAllTools(): import("@singularity-ai/spectra-agent").AgentTool[] {
    const tools: import("@singularity-ai/spectra-agent").AgentTool[] = [];
    for (const api of this.apis.values()) {
      tools.push(...api.getTools());
    }
    return tools;
  }

  getBeforeToolCallHooks() {
    const hooks: Array<(context: import("@singularity-ai/spectra-agent").BeforeToolCallContext, signal?: AbortSignal) => Promise<import("@singularity-ai/spectra-agent").BeforeToolCallResult | undefined>> = [];
    for (const api of this.apis.values()) {
      hooks.push(...api.getBeforeToolCallHooks());
    }
    return hooks;
  }

  getAfterToolCallHooks() {
    const hooks: Array<(context: import("@singularity-ai/spectra-agent").AfterToolCallContext, signal?: AbortSignal) => Promise<import("@singularity-ai/spectra-agent").AfterToolCallResult | undefined>> = [];
    for (const api of this.apis.values()) {
      hooks.push(...api.getAfterToolCallHooks());
    }
    return hooks;
  }

  getTransformContextHooks() {
    const hooks: Array<(messages: import("@singularity-ai/spectra-ai").Message[], signal?: AbortSignal) => Promise<import("@singularity-ai/spectra-ai").Message[]>> = [];
    for (const api of this.apis.values()) {
      hooks.push(...api.getTransformContextHooks());
    }
    return hooks;
  }

  private async getJiti() {
    if (!this.jiti) {
      this.jiti = await loadJiti();
    }
    return this.jiti;
  }
}

async function loadJiti() {
  try {
    const jitiModule = await import("jiti");
    const jitiCreate = jitiModule.createJiti;
    return jitiCreate(import.meta.url, {
      interopDefault: true,
    });
  } catch {
    throw new Error(
      "jiti is required for loading TypeScript extensions. Install it with: bun add jiti",
    );
  }
}