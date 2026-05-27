import type { SsrfResult } from "./types.js"
import { isIP } from "net"
import { URL } from "url"

interface SsrfConfig {
  blockPrivate?: boolean
  blockLoopback?: boolean
  allowedHosts?: string[]
  followRedirects?: boolean
}

export class SsrfGuard {
  private blockPrivate: boolean
  private blockLoopback: boolean
  private allowedHosts: Set<string>
  followRedirects: boolean

  constructor(config?: SsrfConfig) {
    this.blockPrivate = config?.blockPrivate ?? true
    this.blockLoopback = config?.blockLoopback ?? true
    this.allowedHosts = new Set(config?.allowedHosts ?? [])
    this.followRedirects = config?.followRedirects ?? false
  }

  check(rawUrl: string): SsrfResult {
    let hostname: string
    let port: number

    try {
      const url = new URL(rawUrl)
      hostname = url.hostname
      port = parseInt(url.port) || (url.protocol === "https:" ? 443 : 80)
    } catch {
      return { ok: false, reason: `Invalid URL: ${rawUrl}` }
    }

    if (this.allowedHosts.has(hostname)) {
      return { ok: true }
    }

    if (this.isLoopback(hostname)) {
      return {
        ok: false,
        reason: `SSRF blocked: loopback address (${hostname}). Use security.ssrf.allowedHosts to override.`,
      }
    }

    if (this.blockPrivate && this.isPrivate(hostname)) {
      return {
        ok: false,
        reason: `SSRF blocked: private/restricted address (${hostname}). Use security.ssrf.allowedHosts to override.`,
      }
    }

    return { ok: true }
  }

  private isLoopback(hostname: string): boolean {
    if (!this.blockLoopback) return false
    if (hostname === "localhost" || hostname === "localhost.localdomain") return true
    if (hostname === "::1" || hostname === "::") return true
    if (hostname.startsWith("127.")) {
      try {
        const type = isIP(hostname)
        if (type === 4) {
          const octets = hostname.split(".").map(Number)
          return octets.length === 4 && octets[0] === 127
        }
      } catch { return false }
    }
    return false
  }

  private isPrivate(hostname: string): boolean {
    try {
      const type = isIP(hostname)
      if (type === 4) {
        const octets = hostname.split(".").map(Number)
        if (octets.length !== 4) return false
        if (octets[0] === 10) return true
        if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true
        if (octets[0] === 192 && octets[1] === 168) return true
        if (octets[0] === 169 && octets[1] === 254) return true
        if (octets[0] === 0) return true
        if (octets[0] >= 224) return true
        return false
      }
      if (type === 6) {
        if (hostname === "::1" || hostname === "::") return true
        if (hostname.startsWith("fe80:")) return true
        if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true
        return false
      }
    } catch { }
    return false
  }
}
