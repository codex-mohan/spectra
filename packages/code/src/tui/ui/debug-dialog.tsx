import { useMemo, useEffect } from "react"
import { c } from "../theme.js"
import { loadConfig } from "../../services/config.js"
import { listConnectedServers } from "../../integrations/mcp/index.js"
import { readAll } from "../../services/auth-store.js"
import { getGlobalConfigDir, getGlobalDataDir } from "../../utils/paths.js"
import { getPlatformInfo } from "../../utils/platform.js"
import type { SessionStore } from "../../services/session-store.js"
import { titlecase } from "../utils.js"

export interface DebugDialogProps {
  termWidth: number; termHeight: number
  selectedModel: string | null
  provider: string | null
  selectedAgent: string
  thinkingEffort?: string
  sessionStore: SessionStore
  mcpCount: number
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

export function DebugDialog(props: DebugDialogProps) {
  const { termWidth, termHeight, selectedModel, provider, selectedAgent, thinkingEffort, sessionStore, mcpCount, onClose, registerHandler } = props

  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(30, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const innerW = mw - 4

  const info = useMemo(() => {
    const config = loadConfig()
    const connected = listConnectedServers()
    const authStore = readAll()
    const platform = getPlatformInfo()
    const sessions = sessionStore.list()

    const configDir = getGlobalConfigDir()
    const dataDir = getGlobalDataDir()

    const lines: { label: string; value: string }[] = [
      { label: "Version", value: "0.4.1" },
      { label: "Directory", value: platform.cwd },
      { label: "Platform", value: `${platform.os} (${platform.arch})` },
      { label: "Shell", value: platform.shell },
      { label: "", value: "" },
      { label: "Agent", value: titlecase(selectedAgent) },
      { label: "Model", value: selectedModel || "(none)" },
      { label: "Provider", value: provider || "(none)" },
      { label: "Thinking effort", value: thinkingEffort || "default" },
      { label: "", value: "" },
      { label: "MCP servers", value: `${config.mcp?.length ?? 0} configured, ${mcpCount} connected` },
      { label: "Sessions", value: `${sessions.length} total` },
      { label: "Auth keys", value: `${Object.keys(authStore).length} provider(s)` },
      { label: "", value: "" },
      { label: "Config dir", value: configDir },
      { label: "Data dir", value: dataDir },
    ]
    return lines
  }, [selectedModel, provider, selectedAgent, thinkingEffort, sessionStore, mcpCount])

  const maxLabel = useMemo(() => Math.max(...info.map((l) => l.label.length)), [info])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "escape") { onClose(); return }
    })
    return () => registerHandler(null)
  }, [onClose, registerHandler])

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}
        flexDirection="column" paddingX={2} paddingY={1}>
        <box height={1} flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={c.accent} attributes={1}>Debug Info</text>
          <text fg={c.dim}>esc</text>
        </box>
        <box height={1} />
        <box>
          <text fg={c.border}>{"─".repeat(innerW)}</text>
        </box>
        <scrollbox height={mh - 8} scrollY={true} scrollbarOptions={{ visible: false }}>
          <box flexDirection="column" gap={0}>
            {info.map((row, i) => {
              if (!row.label) return <box key={i} height={1} />
              const pad = maxLabel - row.label.length + 1
              return (
                <box key={i} height={1} flexDirection="row">
                  <text fg={c.dim}>{row.label}:</text>
                  <text fg={c.text}>{" ".repeat(pad)}{row.value}</text>
                </box>
              )
            })}
          </box>
        </scrollbox>
        <box paddingTop={1} paddingBottom={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>esc close</text>
        </box>
      </box>
    </box>
  )
}
