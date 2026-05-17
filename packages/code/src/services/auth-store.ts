import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { join } from "path"
import { getGlobalDataDir } from "../utils/paths.js"

// Mirrors opencode's src/auth/index.ts storage pattern
// File: {dataDir}/auth.json with 0o600 permissions (owner-only read/write)

export interface ApiCredential {
  type: "api"
  key: string
  metadata?: Record<string, string>
}

export interface OauthCredential {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
  enterpriseUrl?: string
}

export interface WellKnownCredential {
  type: "wellknown"
  key: string
  token: string
}

export type Credential = ApiCredential | OauthCredential | WellKnownCredential

function authFilePath(): string {
  return join(getGlobalDataDir(), "auth.json")
}

function ensureDataDir(): void {
  const dir = getGlobalDataDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export function readAll(): Record<string, Credential> {
  const file = authFilePath()
  try {
    return JSON.parse(readFileSync(file, "utf-8"))
  } catch {
    return {}
  }
}

export function read(providerId: string): Credential | undefined {
  return readAll()[providerId]
}

export function write(providerId: string, credential: Credential): void {
  ensureDataDir()
  const file = authFilePath()
  const data = readAll()
  data[providerId] = credential
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, encoding: "utf-8" })
}

export function remove(providerId: string): void {
  const file = authFilePath()
  const data = readAll()
  delete data[providerId]
  writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, encoding: "utf-8" })
}

export function listConnected(): string[] {
  return Object.keys(readAll())
}
