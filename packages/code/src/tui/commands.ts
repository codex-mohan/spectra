import type { CmdItem } from "./components/command-palette.js"
import type { SessionStore } from "../services/session-store.js"

export function buildCmdItems(opts: {
  renderer: { destroy: () => void }
  sessionStore: SessionStore
  hasModel: boolean
  selectedModel: string | null
  mcpCount: number
  messagesLength: number
  setRoute: (r: "home" | "chat") => void
  setMessages: (fn: (prev: any[]) => any[]) => void
  setStatus: (s: string) => void
  setElapsedMs: (v: null) => void
  setTokPerSec: (v: null) => void
  setDialogStep: (v: { type: "provider" } | { type: "session-list" } | null) => void
  sessionIdRef: { current: string | null }
}): CmdItem[] {
  const { renderer, sessionStore: s, sessionIdRef, hasModel, selectedModel, mcpCount, setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setDialogStep } = opts
  return [
    { id: "provider", label: "connect provider", desc: hasModel ? "Switch API provider" : "No provider configured", cat: "Provider", action: () => { setDialogStep({ type: "provider" }) } },
    { id: "model-list", label: "switch model", desc: selectedModel || "No model selected", cat: "Model", action: () => {
      if (!hasModel) { setDialogStep({ type: "provider" }); return }
      setStatus(`Current: ${selectedModel}`); setTimeout(() => setStatus("Ready"), 3000)
    } },
    { id: "new", label: "new session", desc: "Start fresh", cat: "Session", action: () => { setMessages(() => []); sessionIdRef.current = null; setRoute("home"); setStatus("Ready"); setElapsedMs(null); setTokPerSec(null) } },
    { id: "sessions", label: "list sessions", desc: "Browse saved sessions", cat: "Session", action: () => { setDialogStep({ type: "session-list" }) } },
    { id: "clear", label: "clear", desc: "Clear conversation", cat: "Session", action: () => { setMessages(() => []); setStatus("Cleared") } },
    { id: "home", label: "go home", desc: "Return to home", cat: "Navigation", action: () => { setRoute("home") } },
    { id: "doctor", label: "doctor", desc: "Run health check", cat: "System", action: () => { renderer.destroy(); import("../commands/doctor.js").then((m) => m.doctorCommand.handler({} as never)) } },
    { id: "about", label: "about", desc: "Version info", cat: "System", action: () => { setStatus("Spectra Code v0.1.0"); setTimeout(() => setStatus("Ready"), 3000) } },
    { id: "help", label: "help", desc: "Keyboard shortcuts", cat: "System", action: () => { setStatus("Esc quit · Tab agents · Ctrl+P palette · Ctrl+L clear"); setTimeout(() => setStatus("Ready"), 4000) } },
    { id: "quit", label: "quit", desc: "Exit", cat: "System", action: () => renderer.destroy() },
  ]
}
