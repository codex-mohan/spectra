import type { CmdItem } from "./components/command-palette.js"
import type { SessionStore } from "../services/session-store.js"

export function buildCmdItems(opts: {
  renderer: { destroy: () => void }
  sessionStore: SessionStore
  hasModel: boolean
  selectedModel: string | null
  provider: string | null
  mcpCount: number
  customProviderCount: number
  messagesLength: number
  showThinking: boolean
  showToolCalls: boolean
  setRoute: (r: "home" | "chat") => void
  setMessages: (fn: (prev: any[]) => any[]) => void
  setStatus: (s: string) => void
  setElapsedMs: (v: null) => void
  setTokPerSec: (v: null) => void
  setTokenUsage: (v: { input: number; output: number }) => void
  setShowThinking: (fn: (v: boolean) => boolean) => void
  setShowToolCalls: (fn: (v: boolean) => boolean) => void
  setHomeKey: (fn: (k: number) => number) => void
  setNavKey: (fn: (k: number) => number) => void
  setDialogStep: (v: { type: "provider" } | { type: "session-list"; mode?: "delete" | "rename" } | { type: "switch-model" } | { type: "manage-providers" } | { type: "doctor"; result: any } | null) => void
  sessionIdRef: { current: string | null }
}): CmdItem[] {
  const { renderer, sessionStore: s, sessionIdRef, hasModel, selectedModel, provider, mcpCount, customProviderCount, messagesLength, showThinking, showToolCalls, setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setTokenUsage, setShowThinking, setShowToolCalls, setHomeKey, setNavKey, setDialogStep } = opts
  return [
    { id: "new", label: "New Session", desc: "Start fresh", cat: "Session", slashName: "new", slashAliases: ["clear"], action: () => {
      setMessages(() => []);
      sessionIdRef.current = null;
      opts.sessionIdRef.current = null;
      setRoute("home");
      setStatus("Ready");
      setElapsedMs(null);
      setTokPerSec(null);
      opts.setTokenUsage?.({ input: 0, output: 0 });
      opts.setHomeKey?.((k: number) => k + 1);
    } },
    { id: "sessions", label: "List Sessions", desc: "Browse saved sessions", cat: "Session", slashName: "sessions", slashAliases: ["resume", "continue"], action: () => { setDialogStep({ type: "session-list" }) } },
    { id: "delete-session", label: "Delete Session", desc: "Remove a saved session", cat: "Session", slashName: "delete-session", action: () => { setDialogStep({ type: "session-list", mode: "delete" }) } },
    { id: "rename-session", label: "Rename Session", desc: "Change session title", cat: "Session", slashName: "rename", action: () => { setDialogStep({ type: "session-list", mode: "rename" }) } },
    { id: "fork-session", label: "Fork Session", desc: "Copy session to new one", cat: "Session", slashName: "fork", action: () => {
      const sid = opts.sessionIdRef.current;
      if (!sid) { setStatus("No active session"); return; }
      const forked = s.fork(sid);
      if (forked) {
        sessionIdRef.current = forked.id;
        opts.sessionIdRef.current = forked.id;
        setStatus(`Forked: ${forked.title}`);
      }
    } },
    { id: "archive-session", label: "Archive Session", desc: "Move session to archive", cat: "Session", slashName: "archive", action: () => {
      const sid = opts.sessionIdRef.current;
      if (!sid) { setStatus("No active session"); return; }
      s.archive(sid);
      sessionIdRef.current = null;
      opts.sessionIdRef.current = null;
      setMessages(() => []);
      setRoute("home");
      opts.setHomeKey?.((k: number) => k + 1);
      setStatus("Session archived");
    } },
    { id: "clear", label: "Clear", desc: "Clear conversation", cat: "Session", slashName: "clear", action: () => { setMessages(() => []); setStatus("Cleared") } },
    { id: "toggle-thinking", label: `${showThinking ? "Hide" : "Show"} Thinking`, desc: showThinking ? "Hide thinking blocks" : "Show thinking blocks", cat: "Display", slashName: "thinking", slashAliases: ["toggle-thinking"], action: () => { setShowThinking((v) => !v) } },
    { id: "toggle-tools", label: `${showToolCalls ? "Hide" : "Show"} Tool Calls`, desc: showToolCalls ? "Hide tool call indicators" : "Show tool call indicators", cat: "Display", slashName: "tools", slashAliases: ["toggle-tools"], action: () => { setShowToolCalls((v) => !v) } },
    { id: "provider", label: "Connect Provider", desc: hasModel ? "Switch API provider" : "No provider configured", cat: "Provider", slashName: "connect", slashAliases: ["provider"], action: () => { setDialogStep({ type: "provider" }) } },
    { id: "switch-model", label: "Switch Model", desc: selectedModel || "No model selected", cat: "Model", slashName: "model", slashAliases: ["models", "switch-model"], action: () => {
      setDialogStep({ type: "switch-model" })
    } },
    { id: "manage-providers", label: "Manage Providers", desc: `${opts.customProviderCount} custom provider${opts.customProviderCount !== 1 ? "s" : ""}`, cat: "Provider", slashName: "providers", action: () => { setDialogStep({ type: "manage-providers" }) } },
    { id: "home", label: "Go Home", desc: "Return to home", cat: "Navigation", slashName: "home", action: () => { setRoute("home") } },
    { id: "doctor", label: "Doctor", desc: "Run health check", cat: "System", slashName: "doctor", action: () => {
      setDialogStep({ type: "doctor", result: null } as any)
      import("../commands/doctor.js").then((m) => m.runDoctor().then((result: any) => {
        setDialogStep({ type: "doctor", result } as any)
      }))
    } },
    { id: "about", label: "About", desc: "Version info", cat: "System", slashName: "about", action: () => { setStatus("Spectra Code v0.1.0"); setTimeout(() => setStatus("Ready"), 3000) } },
    { id: "help", label: "Help", desc: "Keyboard shortcuts", cat: "System", slashName: "help", action: () => { setStatus("Esc quit · Tab agents · Ctrl+P palette · Ctrl+L clear"); setTimeout(() => setStatus("Ready"), 4000) } },
    { id: "quit", label: "Quit", desc: "Exit", cat: "System", slashName: "exit", slashAliases: ["quit", "q"], action: () => renderer.destroy() },
  ]
}

export function collectSlashNames(items: CmdItem[]): Set<string> {
  const names = new Set<string>()
  for (const item of items) {
    if (item.slashName) names.add(item.slashName)
    if (item.slashAliases) {
      for (const alias of item.slashAliases) names.add(alias)
    }
  }
  return names
}
