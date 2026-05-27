import { existsSync } from "fs"
import { resolve } from "path"
import type { WriteGuardResult } from "./types.js"
import { canonicalPath } from "./wildcard.js"

type WriteGuardMode = "soft" | "strict" | "off"

export class ReadTracker {
  private readPaths = new Set<string>()
  private writtenPaths = new Set<string>()
  private warnedPaths = new Set<string>()
  private mode: WriteGuardMode
  private exclude: Set<string>

  constructor(config?: { mode?: WriteGuardMode; exclude?: string[] }) {
    this.mode = config?.mode ?? "soft"
    this.exclude = new Set(config?.exclude ?? [])
  }

  recordRead(filePath: string, cwd: string = process.cwd()): void {
    if (this.mode === "off") return
    const c = canonicalPath(filePath, cwd)
    this.readPaths.add(c)
    this.warnedPaths.delete(c)
  }

  recordWrite(filePath: string, cwd: string = process.cwd()): void {
    if (this.mode === "off") return
    const c = canonicalPath(filePath, cwd)
    this.writtenPaths.add(c)
    this.readPaths.add(c)
  }

  checkWrite(filePath: string, cwd: string = process.cwd(), toolName?: string): WriteGuardResult {
    if (this.mode === "off") return { ok: true }
    if (toolName && this.exclude.has(toolName)) return { ok: true }

    const c = canonicalPath(filePath, cwd)

    if (!existsSync(c)) return { ok: true }

    if (this.readPaths.has(c) || this.writtenPaths.has(c)) return { ok: true }

    const displayPath = (() => {
      const rel = (() => { try { return require("path").relative(cwd, c) } catch { return c } })()
      return rel || c
    })()

    if (this.mode === "strict") {
      return {
        ok: false,
        blocked: true,
        reason: `Refused: write to existing file '${displayPath}' without prior read. Read the file first.`,
      }
    }

    if (this.warnedPaths.has(c)) {
      this.recordWrite(filePath, cwd)
      return { ok: true }
    }

    this.warnedPaths.add(c)
    return {
      ok: false,
      warning: true,
      reason: `Refused: write would overwrite existing '${displayPath}' you haven't read. Call read first, or retry — second attempt is allowed.`,
    }
  }

  isTracked(filePath: string, cwd: string = process.cwd()): boolean {
    return this.readPaths.has(canonicalPath(filePath, cwd))
  }

  reset(): void {
    this.readPaths.clear()
    this.writtenPaths.clear()
    this.warnedPaths.clear()
  }
}
