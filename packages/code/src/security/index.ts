import type {
  Rule, Ruleset, PermissionAction, PermissionConfig,
  PermissionRequest, PermissionResponse,
  SecurityConfig, ToolCapabilities,
} from "./types.js"
import { evaluate, fromConfig, getCanonicalPermission } from "./permissions.js"
import { PathSafety } from "./path-safety.js"
import { ReadTracker } from "./read-tracker.js"
import { DoomLoopDetector } from "./doom-loop.js"
import { SsrfGuard } from "./ssrf-guard.js"
import { isInsideWorkingDir, canonicalPath } from "./wildcard.js"
import { resolve } from "path"
import { URL } from "url"

export type { Rule, Ruleset, PermissionAction, SecurityConfig, ToolCapabilities }
export { evaluate, fromConfig } from "./permissions.js"
export { PathSafety } from "./path-safety.js"
export { ReadTracker } from "./read-tracker.js"
export { DoomLoopDetector } from "./doom-loop.js"
export { SsrfGuard } from "./ssrf-guard.js"

export class PermissionDeniedError extends Error {
  constructor(
    public readonly permission: string,
    public readonly pattern: string,
  ) {
    super(`Permission denied: '${permission}' for '${pattern}'`)
    this.name = "PermissionDeniedError"
  }
}

interface PendingRequest {
  id: string
  permission: string
  pattern: string
  tool: string
  details: string
  always: string[]
  resolve: () => void
  reject: (err: Error) => void
}

type PermissionListener = (req: PermissionRequest) => void

interface PermissionManagerOptions {
  config?: PermissionConfig
  security?: SecurityConfig
  sessionRuleset?: Ruleset
  cwd?: string
}

export function createSecurityManager(options: PermissionManagerOptions = {}) {
  const configRuleset = options.config ? fromConfig(options.config) : []
  const sessionRuleset = options.sessionRuleset ?? []

  const pathSafety = new PathSafety({
    blockedPaths: options.security?.blockedPaths,
    allowedPaths: options.security?.allowedPaths,
  })
  const readTracker = new ReadTracker({
    mode: options.security?.writeGuard ?? "soft",
    exclude: options.security?.writeGuardExclude,
  })
  const doomLoop = new DoomLoopDetector(options.security?.doomLoop)
  const ssrfGuard = new SsrfGuard(options.security?.ssrf)

  const cwd = options.cwd ?? process.cwd()

  let approvedRuleset: Ruleset = []
  const pendingRequests = new Map<string, PendingRequest>()
  let listener: PermissionListener | null = null

  function getRuleset(): Ruleset {
    return [...configRuleset, ...approvedRuleset, ...sessionRuleset]
  }

  function setListener(fn: PermissionListener | null): void {
    listener = fn
  }

  function addApproval(rules: Rule[]): void {
    approvedRuleset.push(...rules)
  }

  function getReadTracker(): ReadTracker { return readTracker }
  function getDoomLoop(): DoomLoopDetector { return doomLoop }
  function getSsrfGuard(): SsrfGuard { return ssrfGuard }
  function getPathSafety(): PathSafety { return pathSafety }

  function checkPath(rawPath: string): void {
    const result = pathSafety.check(rawPath, cwd)
    if (!result.ok) {
      throw new PermissionDeniedError("path_safety", rawPath)
    }
  }

  async function checkPermission(
    permission: string,
    patterns: string[],
    tool?: string,
    details?: string,
  ): Promise<void> {
    for (const pattern of patterns) {
      const rule = evaluate(permission, pattern, getRuleset())

      if (rule.action === "deny") {
        throw new PermissionDeniedError(permission, pattern)
      }

      if (rule.action === "ask") {
        await requestApproval(permission, pattern, tool, details)
      }
    }
  }

  async function requestApproval(
    permission: string,
    pattern: string,
    tool?: string,
    details?: string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const id = Math.random().toString(36).slice(2, 10)
      const alwaysPatterns = generateAlwaysPatterns(permission, pattern)

      const pending: PendingRequest = {
        id,
        permission,
        pattern,
        tool: tool ?? permission,
        details: details ?? pattern,
        always: alwaysPatterns,
        resolve,
        reject,
      }

      pendingRequests.set(id, pending)

      listener?.({
        id,
        permission,
        pattern,
        tool: tool ?? permission,
        details: details ?? pattern,
        always: alwaysPatterns,
      })

      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id)
          reject(new PermissionDeniedError(permission, pattern))
        }
      }, 120000)
    })
  }

  function respondToRequest(id: string, response: PermissionResponse): void {
    const pending = pendingRequests.get(id)
    if (!pending) return
    pendingRequests.delete(id)

    if (response.action === "deny") {
      pending.reject(new PermissionDeniedError(pending.permission, pending.pattern))
      return
    }

    if (response.action === "always") {
      for (const alwaysPattern of pending.always) {
        approvedRuleset.push({
          permission: pending.permission,
          pattern: alwaysPattern,
          action: "allow",
        })
      }
    }

    pending.resolve()
  }

  function generateAlwaysPatterns(permission: string, pattern: string): string[] {
    if (permission === "external_directory") {
      return [pattern, pattern + "/**"]
    }
    if (permission === "write") {
      const resolved = canonicalPath(pattern, cwd)
      return [pattern, resolved]
    }
    if (permission === "bash") {
      const parts = pattern.split(/\s+/)
      if (parts.length >= 2) {
        return [pattern, `${parts[0]} ${parts[1]} *`, `${parts[0]} *`]
      }
      return [`${pattern} *`]
    }
    return [pattern]
  }

  function extractToolPatterns(
    toolName: string,
    args: Record<string, unknown>,
  ): { toolPatterns: string[]; externalPaths: string[]; pathPatterns: string[] } {
    const toolPatterns: string[] = []
    const externalPaths: string[] = []
    const pathPatterns: string[] = []

    const rawPath = (args.path || args.file_path || args.filePath) as string | undefined

    if (rawPath) {
      pathPatterns.push(rawPath)
      try {
        const abs = resolve(cwd, rawPath)
        pathPatterns.push(abs)
        if (!isInsideWorkingDir(rawPath, cwd)) {
          externalPaths.push(rawPath)
          externalPaths.push(abs)
        }
      } catch {}
    }

    if (toolName === "bash" || toolName === "shell") {
      const command = args.command as string | undefined
      if (command) {
        const firstLine = command.split("\n")[0].trim()
        toolPatterns.push(firstLine)
        const parts = firstLine.split(/\s+/).filter(Boolean)
        if (parts.length >= 2) {
          toolPatterns.push(`${parts[0]} ${parts[1]} *`)
        }
        toolPatterns.push(`${parts[0]} *`)
      }
    }

    if (toolName === "web_fetch" || toolName === "webfetch") {
      const url = args.url as string | undefined
      if (url) {
        try {
          toolPatterns.push(new URL(url).hostname)
        } catch {}
      }
    }

    if (toolName === "task") {
      const subagent = (args.subagent_name || args.subagent_type) as string | undefined
      if (subagent) toolPatterns.push(subagent)
    }

    if (toolPatterns.length === 0 && pathPatterns.length > 0) {
      toolPatterns.push(...pathPatterns)
    }

    if (toolPatterns.length === 0) {
      toolPatterns.push("*")
    }

    return { toolPatterns, externalPaths, pathPatterns }
  }

  return {
    getReadTracker,
    getDoomLoop,
    getSsrfGuard,
    getPathSafety,
    checkPath,
    checkPermission,
    extractToolPatterns,
    setListener,
    addApproval,
    respondToRequest,
    getRuleset,
    get pendingCount() { return pendingRequests.size },
  }
}

export type SecurityManager = ReturnType<typeof createSecurityManager>
