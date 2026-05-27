import type { DoomLoopResult } from "./types.js"

interface DoomLoopCall {
  tool: string
  args: string
  count: number
  firstTime: number
}

interface DoomLoopConfig {
  writeRepeatThreshold?: number
  readOnlyRepeatThreshold?: number
  patchSpiralThreshold?: number
}

export class DoomLoopDetector {
  private callHistory: DoomLoopCall[] = []
  private consecutiveReads = 0
  private patchFailures = new Map<string, number>()
  private writeThreshold: number
  private readOnlyThreshold: number
  private patchThreshold: number

  constructor(config?: DoomLoopConfig) {
    this.writeThreshold = config?.writeRepeatThreshold ?? 3
    this.readOnlyThreshold = config?.readOnlyRepeatThreshold ?? 8
    this.patchThreshold = config?.patchSpiralThreshold ?? 4
  }

  recordToolCall(
    tool: string,
    args: Record<string, unknown>,
  ): DoomLoopResult {
    const argsKey = JSON.stringify(args)
    const now = Date.now()

    const recent = this.callHistory.filter((c) => now - c.firstTime < 60000)
    this.callHistory = recent

    const existing = this.callHistory.find(
      (c) => c.tool === tool && c.args === argsKey,
    )

    if (existing) {
      existing.count++
      if (existing.count >= this.writeThreshold) {
        return {
          ok: false,
          action: "stop",
          message: `Doom loop detected: '${tool}' called ${existing.count} times with identical arguments. Breaking loop.`,
        }
      }
    } else {
      this.callHistory.push({ tool, args: argsKey, count: 1, firstTime: now })
    }

    return { ok: true }
  }

  recordToolResult(tool: string, isSuccess: boolean): DoomLoopResult {
    const writeTools = new Set(["edit", "write", "apply_patch", "bash"])

    if (isSuccess && writeTools.has(tool)) {
      this.consecutiveReads = 0
    } else if (!writeTools.has(tool)) {
      this.consecutiveReads++
    }

    if (this.consecutiveReads >= this.readOnlyThreshold) {
      return {
        ok: false,
        action: "warn",
        message: `Read-only loop detected: ${this.consecutiveReads} consecutive reads with no writes. Consider switching agents or stopping.`,
      }
    }

    return { ok: true }
  }

  recordPatchFailure(filePath: string): DoomLoopResult {
    const failures = (this.patchFailures.get(filePath) ?? 0) + 1
    this.patchFailures.set(filePath, failures)

    if (failures >= this.patchThreshold) {
      return {
        ok: false,
        action: "warn",
        message: `Patch spiral on '${filePath}': ${failures} consecutive failures. Consider using write instead of edit.`,
      }
    }

    return { ok: true }
  }

  recordPatchSuccess(filePath: string): void {
    this.patchFailures.delete(filePath)
  }

  reset(): void {
    this.callHistory = []
    this.consecutiveReads = 0
    this.patchFailures.clear()
  }
}
