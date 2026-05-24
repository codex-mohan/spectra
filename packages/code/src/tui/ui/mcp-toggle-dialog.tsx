import { useState, useEffect, useMemo } from "react"
import { c } from "../theme.js"
import { loadConfig, saveConfig } from "../../services/config.js"
import { listConnectedServers, connectServer, disconnectServer } from "../../integrations/mcp/index.js"

export interface McpToggleDialogProps {
  termWidth: number; termHeight: number
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function McpToggleDialog(props: McpToggleDialogProps) {
  const { termWidth, termHeight, onClose, registerHandler } = props
  const [refreshKey, setRefreshKey] = useState(0)
  const [sel, setSel] = useState(0)

  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(20, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))

  const config = loadConfig()
  const servers = config.mcp ?? []
  const connected = listConnectedServers()
  const connectedNames = new Set(connected.map((s) => s.name))

  const items = useMemo(() => {
    return servers.map((s) => ({
      name: s.name,
      enabled: s.enabled !== false,
      connected: connectedNames.has(s.name),
      target: s.command ? [s.command, ...(s.args ?? [])].join(" ") : s.url || "",
    }))
  }, [servers, refreshKey])

  useEffect(() => {
    // Refresh connected list on open
    const interval = setInterval(() => setRefreshKey((k) => k + 1), 2000)
    registerHandler((key: any) => {
      if (key.name === "up") { setSel((s) => Math.max(0, s - 1)); return }
      if (key.name === "down") { setSel((s) => Math.min(items.length - 1, s + 1)); return }
      if (key.name === "return" || key.name === "enter") {
        if (!items[sel]) return
        const server = servers[sel]
        if (!server) return
        const isConnected = connectedNames.has(server.name)
        if (isConnected) {
          disconnectServer(server.name).catch(() => {})
        } else if (server.enabled !== false) {
          connectServer({
            name: server.name,
            command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
            url: server.url,
            headers: server.headers,
            env: server.env,
            enabled: server.enabled,
            timeout: server.timeout,
          }).catch(() => {})
        } else {
          const cfg = loadConfig()
          const mcps = cfg.mcp ?? []
          const idx = mcps.findIndex((m) => m.name === server.name)
          if (idx >= 0) {
            mcps[idx] = { ...mcps[idx], enabled: !mcps[idx].enabled }
            cfg.mcp = mcps
            saveConfig(cfg)
          }
        }
        setTimeout(() => setRefreshKey((k) => k + 1), 500)
        return
      }
      if (key.name === "escape") { onClose(); return }
    })
    return () => { clearInterval(interval); registerHandler(null) }
  }, [items, sel, servers, onClose, registerHandler])

  if (servers.length === 0) {
    return (
      <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
        <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}
          alignItems="center" justifyContent="center">
          <text fg={c.dim}>No MCP servers configured.</text>
          <text fg={c.dim}>Use "spectra mcp add" to add one.</text>
        </box>
      </box>
    )
  }

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box height={1} paddingX={2} paddingTop={1}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={c.accent}>MCP Servers</text>
          <box height={1}><text fg={c.dim}>esc</text></box>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}>
          <text fg={c.border}>{"─".repeat(mw - 4)}</text>
        </box>
        <scrollbox paddingX={1} maxHeight={mh - 6} scrollY={true} scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            {items.map((item, i) => {
              const isSelected = i === sel
              const status = item.connected ? "connected" : item.enabled ? "disconnected" : "disabled"
              const statusColor = item.connected ? c.accent : item.enabled ? c.warn : c.dim
              return (
                <box key={item.name} height={2} paddingLeft={2} paddingRight={1}
                  backgroundColor={isSelected ? c.bgSelect : c.bgCard}
                  flexDirection="column">
                  <box flexDirection="row" alignItems="center" gap={1}>
                    <text fg={statusColor}>{"\u25CF"}</text>
                    <text fg={isSelected ? c.accent : c.text}>{item.name}</text>
                    <text fg={statusColor}>[{status}]</text>
                  </box>
                  <text fg={c.dim} overflow="hidden" wrapMode="none">{item.target}</text>
                </box>
              )
            })}
          </box>
        </scrollbox>
        <box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} toggle · esc close</text>
        </box>
      </box>
    </box>
  )
}
