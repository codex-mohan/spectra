import { readFile, stat, readdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";

export interface ContextFile {
  filePath: string;
  content: string;
  priority: number;
  source: string;
}

const CONTEXT_FILE_NAMES = [
  { name: "SPECTRA.md", priority: 100 },
  { name: "AGENTS.md", priority: 80 },
  { name: "CLAUDE.md", priority: 60 },
  { name: "GEMINI.md", priority: 40 },
  { name: "COPILOT.md", priority: 20 },
];

const COMPAT_DIR_FILE = [
  { dir: ".opencode", file: "INSTRUCTIONS.md", priority: 70 },
  { dir: ".pi", file: "INSTRUCTIONS.md", priority: 50 },
  { dir: ".claude", file: "CLAUDE.md", priority: 60 },
];

export async function discoverContextFiles(
  cwd: string = process.cwd(),
  customPriorities?: Record<string, number>,
  additionalDirs?: string[],
): Promise<ContextFile[]> {
  const files: ContextFile[] = [];
  const seen = new Set<string>();

  for (const { name, priority } of CONTEXT_FILE_NAMES) {
    const p = customPriorities?.[name] ?? priority;
    const fullPath = join(cwd, name);
    if (seen.has(fullPath)) continue;
    try {
      const content = await readFile(fullPath, "utf-8");
      if (content.trim()) {
        seen.add(fullPath);
        files.push({ filePath: fullPath, content: content.trim(), priority: p, source: name });
      }
    } catch { /* not found */ }
  }

  for (const { dir, file, priority } of COMPAT_DIR_FILE) {
    const p = customPriorities?.[`${dir}/${file}`] ?? priority;
    const fullPath = join(cwd, dir, file);
    if (seen.has(fullPath)) continue;
    try {
      const content = await readFile(fullPath, "utf-8");
      if (content.trim()) {
        seen.add(fullPath);
        files.push({ filePath: fullPath, content: content.trim(), priority: p, source: `${dir}/${file}` });
      }
    } catch { /* not found */ }
  }

  const spectraContextDir = join(cwd, ".spectra", "context");
  try {
    const st = await stat(spectraContextDir);
    if (st.isDirectory()) {
      const entries = await readdir(spectraContextDir);
      for (const entry of entries) {
        if (entry.endsWith(".md") || entry.endsWith(".txt")) {
          const fullPath = join(spectraContextDir, entry);
          if (seen.has(fullPath)) continue;
          try {
            const content = await readFile(fullPath, "utf-8");
            if (content.trim()) {
              seen.add(fullPath);
              files.push({
                filePath: fullPath,
                content: content.trim(),
                priority: customPriorities?.[entry] ?? 90,
                source: `.spectra/context/${entry}`,
              });
            }
          } catch { /* skip */ }
        }
      }
    }
  } catch { /* not found */ }

  for (const dir of additionalDirs ?? []) {
    const absDir = resolve(cwd, dir);
    try {
      const st = await stat(absDir);
      if (st.isDirectory()) {
        const entries = await readdir(absDir);
        for (const entry of entries) {
          if (entry.endsWith(".md") || entry.endsWith(".txt")) {
            const fullPath = join(absDir, entry);
            if (seen.has(fullPath)) continue;
            try {
              const content = await readFile(fullPath, "utf-8");
              if (content.trim()) {
                seen.add(fullPath);
                files.push({
                  filePath: fullPath,
                  content: content.trim(),
                  priority: customPriorities?.[entry] ?? 30,
                  source: `${dir}/${entry}`,
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* not found */ }
  }

  files.sort((a, b) => b.priority - a.priority);
  return files;
}

export function mergeContextContents(files: ContextFile[], separator: string = "\n\n---\n\n"): string {
  return files
    .map((f) => `<!-- Context: ${f.source} (priority: ${f.priority}) -->\n${f.content}`)
    .join(separator);
}

export async function buildSystemContext(
  cwd: string = process.cwd(),
  customPriorities?: Record<string, number>,
  additionalDirs?: string[],
): Promise<string> {
  const files = await discoverContextFiles(cwd, customPriorities, additionalDirs);
  if (files.length === 0) return "";
  return mergeContextContents(files);
}