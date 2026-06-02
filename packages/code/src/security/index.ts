import type {
  Rule, Ruleset, PermissionAction, PermissionConfig,
  PermissionRequest, PermissionResponse,
  SecurityConfig, ToolCapabilities,
} from "./types.js"
import { evaluate, fromConfig } from "./permissions.js"
import { PathSafety } from "./path-safety.js"
import { ReadTracker } from "./read-tracker.js"
import { DoomLoopDetector } from "./doom-loop.js"
import { SsrfGuard } from "./ssrf-guard.js"
import { isInsideWorkingDir, canonicalPath, matchWildcard, ensureDirGlob } from "./wildcard.js"
import { resolve, dirname } from "path"
import { URL } from "url"
import { statSync } from "fs"

export type { Rule, Ruleset, PermissionAction, SecurityConfig, ToolCapabilities }
export { evaluate, fromConfig } from "./permissions.js"
export { PathSafety } from "./path-safety.js"
export { ReadTracker } from "./read-tracker.js"
export { DoomLoopDetector } from "./doom-loop.js"
export { SsrfGuard } from "./ssrf-guard.js"

const BASHLIST_COMMANDS = new Set([
  "shutdown", "reboot", "halt", "poweroff",
  "mkfs", "fdisk", "mkswap", "swapon",
  "telnet", "chroot",
])

const BASHLIST_PATTERNS = [
  "rm -rf /*", "sudo rm -rf /*", "doas rm -rf /*", "rm -rf ~",
  "rm -rf /home*", "rm -rf /root*",
  "dd if=*of=/dev/*",
  "> /dev/sd*", "> /dev/hd*", "> /dev/nvme*",
  ":(){ :|:& };:*",
  "curl * | sh", "curl * | bash", "curl * | zsh",
  "wget * | sh", "wget * | bash", "wget * | zsh",
  "sudo chmod 777 /*", "sudo chown -R /*", "sudo chown -R /",
  "cat .env | curl *", "cat .env | wget *",
  "git push --force origin main", "git push --force origin master",
  "git push -f origin main", "git push -f origin master",
  "git push --force --no-verify origin main",
  "git push --force --no-verify origin master",
]

const FILE_COMMANDS = new Set([
  "cat", "cp", "mv", "rm", "mkdir", "touch", "chmod", "chown",
  "ls", "less", "more", "head", "tail", "file", "stat",
  "diff", "cmp", "find", "ln",
])

const FILE_TOOL_NAMES = new Set(["read", "write", "edit", "grep", "glob"])

function unquoteShell(s: string): string {
  if (s.length >= 2) {
    const first = s[0], last = s[s.length - 1]
    if ((first === "'" && last === "'") || (first === '"' && last === '"')) {
      return s.slice(1, -1)
    }
  }
  return s
}

function extractBashPaths(
  command: string,
  cwd: string,
): { externalPaths: string[]; pathPatterns: string[] } {
  const externalPaths: string[] = []
  const pathPatterns: string[] = []

  for (const firstLine of command.split("\n")) {
    const trimmed = firstLine.trim()
    if (!trimmed) continue

    const segments = trimmed.split(/(?<!\\);/)
    for (const segment of segments) {
      const parts = segment.trim().split(/\s+/).filter(Boolean)
      if (parts.length < 2) continue

      const cmd = (parts[0] || "").toLowerCase()
      if (!FILE_COMMANDS.has(cmd)) continue

      for (const arg of parts.slice(1)) {
        if (arg.startsWith("-") || arg.startsWith("--")) continue
        const unquoted = unquoteShell(arg)

        try {
          const resolved = resolve(cwd, unquoted)
          pathPatterns.push(resolved)
          if (!isInsideWorkingDir(unquoted, cwd)) {
            externalPaths.push(resolved)
          }
        } catch {}
      }
    }
  }

  return { externalPaths, pathPatterns }
}

function isBashBlocked(command: string): boolean {
  const firstWord = command.trim().split(/\s+/)[0] || ""

  if (BASHLIST_COMMANDS.has(firstWord)) return true

  const normalized = command.trim()
  return BASHLIST_PATTERNS.some((p) => matchWildcard(p, normalized))
}

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
  restoredApprovals?: Ruleset
  cwd?: string
  onPersist?: (approvedRules: Ruleset) => void
}

export function createSecurityManager(options: PermissionManagerOptions = {}) {
  const configRuleset = options.config ? fromConfig(options.config) : []
  const sessionRuleset = options.sessionRuleset ?? []
  const restoredFromDisk = options.restoredApprovals ?? []

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

  let approvedRuleset: Ruleset = [...restoredFromDisk]
  const pendingRequests = new Map<string, PendingRequest>()
  let listener: PermissionListener | null = null
  const onPersist = options.onPersist

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

  function getApprovedConfig(): PermissionConfig {
    const config: PermissionConfig = {}
    for (const rule of approvedRuleset) {
      if (rule.action !== "allow") continue
      const existing = config[rule.permission]
      if (typeof existing === "object" && existing !== null) {
        ;(existing as Record<string, PermissionAction>)[rule.pattern] = "allow"
      } else {
        config[rule.permission] = { [rule.pattern]: "allow" }
      }
    }
    return config
  }

  function checkPath(rawPath: string): void {
    const result = pathSafety.check(rawPath, cwd)
    if (!result.ok) {
      throw new PermissionDeniedError("path_safety", rawPath)
    }
  }

  function internalPathsOnly(permission: string, patterns: string[]): boolean {
    if (!FILE_TOOL_NAMES.has(permission) && permission !== "external_directory") {
      return false
    }
    return patterns.every((p) => {
      if (p === "*") return false
      try { return isInsideWorkingDir(p, cwd) } catch { return false }
    })
  }

  async function checkPermission(
    permission: string,
    patterns: string[],
    tool?: string,
    details?: string,
  ): Promise<void> {
    const isBash = permission === "bash" || permission === "shell"

    if (isBash) {
      const command = patterns[0] ?? ""
      if (isBashBlocked(command)) {
        throw new PermissionDeniedError(permission, command)
      }
    }

    const ruleset = getRuleset()

    for (const pattern of patterns) {
      const rule = evaluate(permission, pattern, ruleset)

      if (rule.action === "deny") {
        throw new PermissionDeniedError(permission, pattern)
      }

      if (rule.action === "allow") {
        return
      }
    }

    if (isBash) {
      return
    }

    if (internalPathsOnly(permission, patterns)) {
      return
    }

    await requestApproval(permission, patterns[0], tool, details ?? patterns[0])
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

      cascadeAutoResolve()
      onPersist?.(approvedRuleset)
    }

    pending.resolve()
  }

  function cascadeAutoResolve(): void {
    const ruleset = getRuleset()
    for (const [pid, entry] of pendingRequests) {
      const allAllowed = entry.always.every((ap) =>
        evaluate(entry.permission, ap, ruleset).action === "allow"
      )
      if (allAllowed) {
        pendingRequests.delete(pid)
        entry.resolve()
      }
    }
  }

  function generateAlwaysPatterns(permission: string, pattern: string): string[] {
    if (permission === "external_directory") {
      const resolved = canonicalPath(pattern, cwd)
      let dir: string
      try {
        const st = statSync(resolved)
        dir = st.isDirectory() ? resolved : dirname(resolved)
      } catch {
        dir = dirname(resolved)
      }
      return [pattern, ensureDirGlob(dir)]
    }

    if (FILE_TOOL_NAMES.has(permission)) {
      return ["*"]
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

        const { externalPaths: bashExtPaths, pathPatterns: bashPathPatterns } =
          extractBashPaths(command, cwd)
        if (bashExtPaths.length > 0) {
          for (const ep of bashExtPaths) {
            if (!externalPaths.some((e) => resolve(cwd, e) === ep)) {
              externalPaths.push(ep)
            }
          }
        }
        for (const pp of bashPathPatterns) {
          if (!pathPatterns.some((p) => resolve(cwd, p) === pp)) {
            pathPatterns.push(pp)
          }
        }
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
    getApprovedConfig,
    get pendingCount() { return pendingRequests.size },
  }
}

export type SecurityManager = ReturnType<typeof createSecurityManager>
