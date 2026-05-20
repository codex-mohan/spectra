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
  setDialogStep: (v: { type: "provider" } | { type: "session-list"; mode?: "delete" | "rename" } | { type: "switch-model" } | { type: "manage-providers" } | null) => void
  sessionIdRef: { current: string | null }
}): CmdItem[] {
  const { renderer, sessionStore: s, sessionIdRef, hasModel, selectedModel, provider, mcpCount, customProviderCount, messagesLength, showThinking, showToolCalls, setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setTokenUsage, setShowThinking, setShowToolCalls, setHomeKey, setNavKey, setDialogStep } = opts
  return [
    { id: "new", label: "New Session", desc: "Start fresh", cat: "Session", action: () => {
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
    { id: "sessions", label: "List Sessions", desc: "Browse saved sessions", cat: "Session", action: () => { setDialogStep({ type: "session-list" }) } },
    { id: "delete-session", label: "Delete Session", desc: "Remove a saved session", cat: "Session", action: () => { setDialogStep({ type: "session-list", mode: "delete" }) } },
    { id: "rename-session", label: "Rename Session", desc: "Change session title", cat: "Session", action: () => { setDialogStep({ type: "session-list", mode: "rename" }) } },
    { id: "fork-session", label: "Fork Session", desc: "Copy session to new one", cat: "Session", action: () => {
      const sid = opts.sessionIdRef.current;
      if (!sid) { setStatus("No active session"); return; }
      const forked = s.fork(sid);
      if (forked) {
        sessionIdRef.current = forked.id;
        opts.sessionIdRef.current = forked.id;
        setStatus(`Forked: ${forked.title}`);
      }
    } },
    { id: "archive-session", label: "Archive Session", desc: "Move session to archive", cat: "Session", action: () => {
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
    { id: "clear", label: "Clear", desc: "Clear conversation", cat: "Session", action: () => { setMessages(() => []); setStatus("Cleared") } },
    { id: "toggle-thinking", label: `${showThinking ? "Hide" : "Show"} Thinking`, desc: showThinking ? "Hide thinking blocks" : "Show thinking blocks", cat: "Display", action: () => { setShowThinking((v) => !v) } },
    { id: "toggle-tools", label: `${showToolCalls ? "Hide" : "Show"} Tool Calls`, desc: showToolCalls ? "Hide tool call indicators" : "Show tool call indicators", cat: "Display", action: () => { setShowToolCalls((v) => !v) } },
    { id: "provider", label: "Connect Provider", desc: hasModel ? "Switch API provider" : "No provider configured", cat: "Provider", action: () => { setDialogStep({ type: "provider" }) } },
    { id: "switch-model", label: "Switch Model", desc: selectedModel || "No model selected", cat: "Model", action: () => {
      setDialogStep({ type: "switch-model" })
    } },
    { id: "manage-providers", label: "Manage Providers", desc: `${opts.customProviderCount} custom provider${opts.customProviderCount !== 1 ? "s" : ""}`, cat: "Provider", action: () => { setDialogStep({ type: "manage-providers" }) } },
    { id: "home", label: "Go Home", desc: "Return to home", cat: "Navigation", action: () => { setRoute("home") } },
    { id: "doctor", label: "Doctor", desc: "Run health check", cat: "System", action: () => { renderer.destroy(); import("../commands/doctor.js").then((m) => m.doctorCommand.handler({} as never)) } },
    { id: "about", label: "About", desc: "Version info", cat: "System", action: () => { setStatus("Spectra Code v0.1.0"); setTimeout(() => setStatus("Ready"), 3000) } },
    { id: "help", label: "Help", desc: "Keyboard shortcuts", cat: "System", action: () => { setStatus("Esc quit · Tab agents · Ctrl+P palette · Ctrl+L clear"); setTimeout(() => setStatus("Ready"), 4000) } },
    { id: "quit", label: "Quit", desc: "Exit", cat: "System", action: () => renderer.destroy() },
  ]
}
