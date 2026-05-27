export type PermissionAction = "allow" | "ask" | "deny"

export interface Rule {
  permission: string
  pattern: string
  action: PermissionAction
}

export type Ruleset = Rule[]

export interface PermissionRequest {
  id: string
  permission: string
  pattern: string
  tool?: string
  details?: string
  always?: string[]
}

export interface PermissionResponse {
  action: "once" | "always" | "deny"
}

export type WriteGuardResult =
  | { ok: true }
  | { ok: false; reason: string; warning?: boolean; blocked?: boolean }

export type DoomLoopResult =
  | { ok: true }
  | { ok: false; action: "warn" | "stop"; message: string }

export type PathSafetyResult =
  | { ok: true; resolvedPath: string; displayPath: string }
  | { ok: false; reason: string }

export type SsrfResult =
  | { ok: true }
  | { ok: false; reason: string }

export interface ToolCapabilities {
  reads: boolean
  writes: boolean
}

export interface SecurityConfig {
  writeGuard?: "soft" | "strict" | "off"
  writeGuardExclude?: string[]
  blockedPaths?: string[]
  allowedPaths?: string[]
  ssrf?: {
    blockPrivate?: boolean
    blockLoopback?: boolean
    allowedHosts?: string[]
    followRedirects?: boolean
  }
  doomLoop?: {
    writeRepeatThreshold?: number
    readOnlyRepeatThreshold?: number
    patchSpiralThreshold?: number
  }
}

export type PermissionConfig = Record<string, string | Record<string, PermissionAction>>
