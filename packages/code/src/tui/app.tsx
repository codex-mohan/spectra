import { useRef, useCallback, useEffect, useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { execSync } from "child_process"
import { c, SPINNER } from "./theme.js"
import { ChatArea } from "./components/chat-area.js"
import { CommandPalette, type CmdItem } from "./components/command-palette.js"
import { PromptBar } from "./prompt-bar.js"
import { Tips } from "./tips.js"
import { genId, getMessageBlocks } from "./utils.js"
import type { ChatMessage, ContentBlock } from "./types.js"
import { SessionStore } from "../services/session-store.js"
import type { AssistantMessage } from "@singularity-ai/spectra-ai"
import { ProviderDialog } from "./ui/provider-dialog.js"
import { buildCmdItems } from "./commands.js"
import { getGlobalConfigDir } from "../utils/paths.js"
import { existsSync, readFileSync } from "fs"
import { join } from "path"

const AGENTS = ["build", "plan", "debug", "explore"]

const PLACEHOLDERS = [
  "fix the login bug",
  "explain this codebase",
  "add error handling",
  "refactor this function",
  "write tests",
  "debug this issue",
  "optimize performance",
  "document the API",
]

function loadSavedModel(): string | null {
  try {
    const configPath = join(getGlobalConfigDir(), "spectra.json")
    if (!existsSync(configPath)) return null
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"))
    return cfg.model || null
  } catch { return null }
}

export function App({ renderer }: { renderer: CliRenderer }) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const [route, setRoute] = useState<"home" | "chat">("home")
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState("Ready")
  const [spinnerFrame, setSpinnerFrame] = useState(0)
  const [showCmd, setShowCmd] = useState(false)
  const [cmdFilter, setCmdFilter] = useState("")
  const [cmdSelected, setCmdSelected] = useState(0)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [tokPerSec, setTokPerSec] = useState<number | null>(null)
  const [tokenUsage, setTokenUsage] = useState({ input: 0, output: 0 })
  const [selectedAgent, setSelectedAgent] = useState("build")
  const [selectedModel, setSelectedModel] = useState<string | null>(loadSavedModel())
  const [submitKey, setSubmitKey] = useState(0)
  const [dialogStep, setDialogStep] = useState<{ type: "provider" } | null>(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const sessionStore = useRef(new SessionStore())
  const sessionId = useRef<string | null>(null)

  const provider = selectedModel?.split("/")[0] || null
  const hasModel = selectedModel !== null
  const mcpCount = 0
  const cwdLabel = useMemo(() => {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const dir = process.cwd().replace(home, "~")
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf-8", timeout: 2000 }).toString().trim()
      if (branch) return `${dir}:${branch}`
    } catch {}
    return dir
  }, [])

  // Rotate placeholder
  useEffect(() => {
    const id = setInterval(() => setPlaceholderIdx((p) => (p + 1) % PLACEHOLDERS.length), 4000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!isLoading) return
    const id = setInterval(() => setSpinnerFrame((f) => (f + 1) % SPINNER.length), 80)
    renderer.requestLive()
    return () => { clearInterval(id); renderer.dropLive() }
  }, [isLoading, renderer])

  useKeyboard((key) => {
    if (dialogStep) return
    if (showCmd) {
      if (key.name === "escape" || (key.ctrl && key.name === "p")) { setShowCmd(false); return }
      if (key.name === "return" || key.name === "enter") { if (cmdFiltered.length > 0) { execCmd(cmdFiltered[cmdSelected]); return }; return }
      if (key.name === "up") { setCmdSelected((p) => (p > 0 ? p - 1 : cmdFiltered.length - 1)); return }
      if (key.name === "down") { setCmdSelected((p) => (p < cmdFiltered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setCmdFilter((p) => p.slice(0, -1)); setCmdSelected(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setCmdFilter((p) => p + key.name); setCmdSelected(0); return }
      return
    }
    if (key.name === "escape") { renderer.destroy(); return }
    if (key.name === "tab") { setSelectedAgent((p) => AGENTS[(AGENTS.indexOf(p) + 1) % AGENTS.length]); return }
    if (key.ctrl && key.name === "p") { setShowCmd(true); setCmdFilter(""); setCmdSelected(0); return }
    if (key.ctrl && key.name === "l") { setMessages([]); setStatus("Cleared"); setTimeout(() => setStatus("Ready"), 2000); return }
  })

  const addMessage = useCallback((msg: ChatMessage) => setMessages((p) => [...p, msg]), [])
  const updateMessage = useCallback((id: string, u: Partial<ChatMessage>) => setMessages((p) => p.map((m) => (m.id === id ? { ...m, ...u } : m))), [])

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    // If no model configured, prompt to connect provider
    if (!selectedModel || !provider) {
      setStatus("Connect a provider to send prompts")
      setTimeout(() => setStatus("Ready"), 3000)
      setDialogStep({ type: "provider" })
      return
    }

    setTokPerSec(null); setElapsedMs(null)
    addMessage({ id: genId(), role: "user", content: trimmed, model: selectedModel })
    setIsLoading(true); setStatus("Streaming..."); setRoute("chat")
    if (!sessionId.current) sessionId.current = sessionStore.current.create({ agent: selectedAgent, model: selectedModel }).id
    const aid = genId()
    addMessage({ id: aid, role: "assistant", content: "", blocks: [], streaming: true, model: selectedModel })
    const start = performance.now()
    try {
      const { Agent } = await import("@singularity-ai/spectra-agent")
      const { initProviders } = await import("@singularity-ai/spectra-ai")
      initProviders()
      const model = { id: selectedModel, name: selectedModel, provider, api: provider }
      const agent = new Agent({
        model,
        systemPrompt: `You are Spectra Code, an AI coding agent running on ${process.platform}.`,
      })
      for await (const ev of agent.run(trimmed)) {
        if (ev.type === "message_update" && ev.message.role === "assistant") {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          updateMessage(aid, { content: blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n"), blocks })
        }
        if (ev.type === "message_end" && ev.message.role === "assistant") {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          updateMessage(aid, { content: blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n"), blocks, streaming: false })
          const e = performance.now() - start; setElapsedMs(e)
          const ot = m.usage.output
          if (ot > 0 && e > 0) setTokPerSec(ot / (e / 1000))
          setTokenUsage((p) => ({ input: p.input + m.usage.input, output: p.output + ot }))
        }
        if (ev.type === "tool_execution_start") addMessage({ id: genId(), role: "tool", content: "", meta: `${ev.toolName}(${JSON.stringify(ev.args)})` })
        if (ev.type === "agent_end") setStatus("Ready")
      }
    } catch (err) {
      updateMessage(aid, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false, role: "error" })
      setStatus("Error")
    } finally {
      setIsLoading(false); setSubmitKey((k) => k + 1)
    }
  }, [isLoading, selectedModel, provider, selectedAgent, addMessage, updateMessage])

  const cmdItems = useMemo(() => buildCmdItems({
    renderer, sessionStore: sessionStore.current, sessionIdRef: sessionId,
    hasModel, selectedModel, mcpCount, messagesLength: messages.length,
    setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setDialogStep,
  }), [renderer, hasModel, selectedModel, mcpCount, messages.length])

  const cmdFiltered = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    return !q ? cmdItems : cmdItems.filter((i) => i.label.includes(q) || i.desc.includes(q) || (i.cat && i.cat.toLowerCase().includes(q)))
  }, [cmdItems, cmdFilter])
  const execCmd = useCallback((item: CmdItem) => { item.action(); setShowCmd(false) }, [])

  useEffect(() => { if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1) }, [cmdSelected, cmdFiltered.length])

  return (
    <box flexDirection="column" height={termHeight} backgroundColor={c.bg}>
      {route === "home" ? (
        <>
          <box flexGrow={1} />
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            <ascii-font text="SPECTRA" font="block" color={c.accent} />
            <box height={1} />
            <PromptBar isLoading={isLoading} spinnerFrame={spinnerFrame} submitKey={submitKey}
              placeholder={`Ask anything... "${PLACEHOLDERS[placeholderIdx]}"`}
              onSubmit={handleSubmit} hasModel={hasModel}
              agent={selectedAgent} model={selectedModel || ""} provider={provider || ""}
              width={Math.min(68, termWidth - 8)} />
            <box height={1} />
            <box flexDirection="row" justifyContent="flex-end" width={Math.min(68, termWidth - 8)}>
              <box flexDirection="row" gap={2}>
                <box flexDirection="row"><text fg={c.text}>tab</text><text fg={c.dim}> agents</text></box>
                <box flexDirection="row"><text fg={c.text}>ctrl+p</text><text fg={c.dim}> commands</text></box>
              </box>
            </box>
            <box height={1} />
            <box flexDirection="row" gap={4} alignItems="center">
              {[
                { icon: "◈", label: `${sessionStore.current.list().length} sessions` },
                { icon: "◉", label: "3 agents" },
                { icon: "◆", label: "7 tools" },
                { icon: "⬢", label: `${mcpCount} MCP` },
              ].map((s) => (
                <box key={s.label} flexDirection="row" gap={1} alignItems="center">
                  <text fg={c.accent}>{s.icon}</text>
                  <text fg={c.dim}>{s.label}</text>
                </box>
              ))}
            </box>
            <Tips />
          </box>
          <box flexGrow={1} />
          <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} height={1} marginBottom={1}>
            <box flexDirection="row" gap={4}>
              <text fg={c.dim} overflow="hidden" wrapMode="none">{cwdLabel}</text>
              <text fg={c.dim}>⊙ {mcpCount} MCP</text>
            </box>
            <text fg={c.dim} flexShrink={0}>Spectra Code</text>
          </box>
        </>
      ) : (
        <>
          <box flexDirection="column" flexGrow={1}><ChatArea messages={messages} /></box>
          <PromptBar isLoading={isLoading} spinnerFrame={spinnerFrame} submitKey={submitKey}
            placeholder="Reply..." onSubmit={handleSubmit} hasModel={hasModel}
            agent={selectedAgent} model={selectedModel || ""} provider={provider || ""}
            elapsedMs={elapsedMs} tokenUsage={tokenUsage} width={termWidth - 2} />
        </>
      )}
      {showCmd && <CommandPalette filter={cmdFilter} selected={cmdSelected} items={cmdFiltered} termWidth={termWidth} termHeight={termHeight} />}
      {dialogStep?.type === "provider" && (
        <ProviderDialog termWidth={termWidth} termHeight={termHeight}
          onModelSelected={(modelId) => {
            setSelectedModel(modelId)
            setDialogStep(null)
            setStatus(`✓ Model: ${modelId}`)
            setTimeout(() => setStatus("Ready"), 3000)
          }}
          onClose={() => setDialogStep(null)}
        />
      )}
    </box>
  )
}
