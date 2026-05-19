import { useRef, useCallback, useEffect, useMemo, useState } from "react"
import { useKeyboard, useTerminalDimensions } from "@opentui/react"
import type { CliRenderer } from "@opentui/core"
import { execSync } from "child_process"
import { c, SPINNER } from "./theme.js"
import { ChatArea } from "./components/chat-area.js"
import { CommandPalette } from "./components/command-palette.js"
import { PromptBar } from "./prompt-bar.js"
import { Tips } from "./tips.js"
import { genId, getMessageBlocks } from "./utils.js"
import type { ChatMessage, ContentBlock } from "./types.js"
import { SessionStore } from "../services/session-store.js"
import { readAll } from "../services/auth-store.js"
import type { AssistantMessage, Message } from "@singularity-ai/spectra-ai"
import { ProviderDialog } from "./ui/provider-dialog.js"
import { SessionList } from "./ui/session-list.js"
import { ModelSwitcher } from "./ui/model-switcher.js"
import { ToastContainer, showToast } from "./components/toast.js"
import clipboard from "clipboardy"
import { buildCmdItems } from "./commands.js"
import { getGlobalConfigDir } from "../utils/paths.js"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"

const AGENTS = ["build", "plan", "debug", "explore"]
const PLACEHOLDERS = ["fix the login bug", "explain this codebase", "add error handling", "refactor this function", "write tests", "debug this issue", "optimize performance", "document the API"]

function loadSavedConfig(): { model: string | null; provider: string | null } {
  try {
    const configPath = join(getGlobalConfigDir(), "spectra.json")
    if (!existsSync(configPath)) return { model: null, provider: null }
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"))
    return { model: cfg.model || null, provider: cfg.provider || null }
  } catch { return { model: null, provider: null } }
}

function getAuthKey(providerId: string): string | undefined {
  const cred = readAll()[providerId]
  return cred?.type === "api" ? cred.key : undefined
}

function saveModelConfig(modelId: string, providerId: string) {
  try {
    const configDir = getGlobalConfigDir()
    if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
    const configPath = join(configDir, "spectra.json")
    let cfg: Record<string, unknown> = {}
    try { cfg = JSON.parse(readFileSync(configPath, "utf-8")) } catch { }
    cfg.model = modelId; cfg.provider = providerId
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
  } catch { }
}

export function App({ renderer }: { renderer: CliRenderer }) {
  const { width: termWidth, height: termHeight } = useTerminalDimensions()
  const [savedConfig] = useState(loadSavedConfig)
  const [selectedModel, setSelectedModel] = useState<string | null>(savedConfig.model)
  const [selectedProvider, setSelectedProvider] = useState<string | null>(savedConfig.provider)
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
  const [showThinking, setShowThinking] = useState(true)
  const [showToolCalls, setShowToolCalls] = useState(true)
  const [copiedMsg, setCopiedMsg] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState("build")
  const [submitKey, setSubmitKey] = useState(0)
  const [dialogStep, setDialogStep] = useState<{ type: "provider" } | { type: "session-list"; mode?: "delete" | "rename" } | { type: "switch-model" } | null>(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [navKey, setNavKey] = useState(0)
  const [homeKey, setHomeKey] = useState(0)
  const historyDraft = useRef("")
  const sessionStore = useRef(new SessionStore())
  const sessionId = useRef<string | null>(null)
  const agentRef = useRef<any>(null)
  const dialogKeyHandler = useRef<((key: any) => void) | null>(null)
  const lastModelRef = useRef<string | null>(null)

  const provider = selectedProvider
  const hasModel = selectedModel !== null && selectedProvider !== null
  const mcpCount = 0

  const cwdLabel = useMemo(() => {
    const home = process.env.HOME || process.env.USERPROFILE || ""
    const dir = process.cwd().replace(home, "~")
    try {
      const branch = execSync("git rev-parse --abbrev-ref HEAD 2>/dev/null", { encoding: "utf-8", timeout: 2000 }).toString().trim()
      if (branch) return `${dir}:${branch}`
    } catch { }
    return dir
  }, [])

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

  useEffect(() => {
    const handler = (selection: { getSelectedText: () => string }) => {
      const text = selection.getSelectedText()
      if (!text) return
      setTimeout(() => {
        try {
          clipboard.writeSync(text)
          setCopiedMsg(true)
          setTimeout(() => setCopiedMsg(false), 2500)
        } catch { }
      }, 2000)
    }
    renderer.on("selection", handler)
    return () => { renderer.off?.("selection", handler) }
  }, [renderer])

  useKeyboard((key) => {
    if (dialogStep) { dialogKeyHandler.current?.(key); return }
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
    if (key.name === "up") {
      if (promptHistory.length === 0) return
      if (historyIdx === -1) historyDraft.current = ""
      setHistoryIdx(Math.min(historyIdx + 1, promptHistory.length - 1)); setNavKey((k) => k + 1)
      return
    }
    if (key.name === "down") {
      if (historyIdx === -1) return
      setHistoryIdx(historyIdx - 1); setNavKey((k) => k + 1)
      return
    }
    if (key.name === "tab") { setSelectedAgent((p) => AGENTS[(AGENTS.indexOf(p) + 1) % AGENTS.length]); return }
    if (key.ctrl && key.name === "p") { setShowCmd(true); setCmdFilter(""); setCmdSelected(0); return }
    if (key.ctrl && key.name === "l") { setMessages([]); setStatus("Cleared"); setTimeout(() => setStatus("Ready"), 2000); return }
  })

  const addMessage = useCallback((msg: ChatMessage) => setMessages((p) => [...p, msg]), [])
  const updateMessage = useCallback((id: string, u: Partial<ChatMessage>) => setMessages((p) => p.map((m) => (m.id === id ? { ...m, ...u } : m))), [])
  const shownToolCalls = useRef(new Set<string>())
  const toolMsgMap = useRef(new Map<string, string>()) // toolCallId → tuiMessageId
  const toolArgsMap = useRef(new Map<string, unknown>()) // toolCallId → args
  const streamingIdRef = useRef<string | null>(null)

  const getOrCreateAgent = useCallback(async () => {
    if (!selectedModel || !provider) return null
    if (agentRef.current && lastModelRef.current === `${selectedModel}:${provider}`) return agentRef.current
    const { Agent } = await import("@singularity-ai/spectra-agent")
    const { initProviders } = await import("@singularity-ai/spectra-ai")
    initProviders()
    const { createAllTools, spectraToolToAgentTool } = await import("../tools/index.js")
    agentRef.current = new Agent({
      model: { id: selectedModel, name: selectedModel, provider, api: provider },
      systemPrompt: `You are Spectra Code, an AI coding agent running on ${process.platform}.`,
      getApiKey: (p) => getAuthKey(p),
      tools: createAllTools().map(spectraToolToAgentTool),
      maxTurns: 10,
    })
    lastModelRef.current = `${selectedModel}:${provider}`
    return agentRef.current
  }, [selectedModel, provider])

  function persistMessage(sdkMsg: Message) {
    if (!sessionId.current) return
    sessionStore.current.addMessage(sessionId.current, sdkMsg)
  }

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    if (!selectedModel || !provider) {
      showToast("Connect a provider to send prompts", "warn")
      setDialogStep({ type: "provider" }); return
    }

    setTokPerSec(null); setElapsedMs(null)
    shownToolCalls.current.clear()
    toolMsgMap.current.clear()
    toolArgsMap.current.clear()
    setPromptHistory((prev) => {
      if (prev[0] === trimmed) return prev
      return [trimmed, ...prev].slice(0, 50)
    })
    setHistoryIdx(-1)

    const uid = genId()
    const userMsg: Message = { role: "user", content: trimmed, timestamp: Date.now() }
    addMessage({ id: uid, role: "user", content: trimmed, model: selectedModel })
    setIsLoading(true); setStatus("Streaming..."); setRoute("chat")

    if (!sessionId.current) {
      const sess = sessionStore.current.create({ agent: selectedAgent, model: selectedModel, provider })
      sess.title = `Session ${new Date().toISOString()}`
      sessionStore.current.save(sess)
      sessionId.current = sess.id
      setTokenUsage({ input: 0, output: 0 })
    }
    persistMessage(userMsg)

    const sess = sessionStore.current.get(sessionId.current)
    if (sess && sess.messages.length === 1) {
      sess.title = trimmed.length > 60 ? trimmed.slice(0, 57) + "..." : trimmed
      sessionStore.current.save(sess)
    }

    const start = performance.now()
    let currentAssistantId: string | null = null

    try {
      const agent = await getOrCreateAgent()
      for await (const ev of agent.run(trimmed)) {
        if (ev.type === "message_start" && ev.message.role === "assistant") {
          const newId = genId()
          currentAssistantId = newId
          streamingIdRef.current = newId
          addMessage({ id: newId, role: "assistant", content: "", blocks: [], streaming: true, model: selectedModel })
        }
        if (ev.type === "message_update" && ev.message.role === "assistant" && currentAssistantId) {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          const textContent = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
          updateMessage(currentAssistantId, { content: textContent, blocks })
          if (ev.assistantMessageEvent.type === "toolcall_end") {
            const tc = (ev.assistantMessageEvent as any).toolCall as { id: string; name: string; arguments: Record<string, unknown> }
            if (tc && !shownToolCalls.current.has(tc.id)) {
              shownToolCalls.current.add(tc.id)
              toolArgsMap.current.set(tc.id, tc.arguments)
              const tuiId = genId()
              toolMsgMap.current.set(tc.id, tuiId)
              addMessage({ id: tuiId, role: "tool", content: "", meta: `${tc.name}(${JSON.stringify(tc.arguments || {})})` })
            }
          }
        }
        if (ev.type === "message_end" && ev.message.role === "assistant" && currentAssistantId) {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          const textContent = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
          updateMessage(currentAssistantId, { content: textContent, blocks, streaming: false })
          persistMessage(m)
          const e = performance.now() - start; setElapsedMs(e)
          const ot = m.usage.output
          if (ot > 0 && e > 0) setTokPerSec(ot / (e / 1000))
          setTokenUsage((p) => ({ input: p.input + m.usage.input, output: p.output + ot }))
          currentAssistantId = null
          streamingIdRef.current = null
        }
        if (ev.type === "tool_execution_start") {
          if (!shownToolCalls.current.has(ev.toolCallId)) {
            shownToolCalls.current.add(ev.toolCallId)
            toolArgsMap.current.set(ev.toolCallId, ev.args)
            const tuiId = genId()
            toolMsgMap.current.set(ev.toolCallId, tuiId)
            addMessage({ id: tuiId, role: "tool", content: "", meta: `${ev.toolName}(${JSON.stringify(ev.args || {})})` })
          }
        }
        if (ev.type === "tool_execution_end") {
          const args = toolArgsMap.current.get(ev.toolCallId) || {}
          const toolMsg: any = {
            role: "toolResult",
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            content: ev.result?.content || [],
            isError: ev.isError || false,
            timestamp: Date.now(),
            _args: args,
          }
          persistMessage(toolMsg)
          // Update the existing inline tool message with output
          const tuiId = toolMsgMap.current.get(ev.toolCallId)
          if (tuiId) {
            const toolOutput = ev.result?.content?.[0]?.text || ""
            updateMessage(tuiId, { content: toolOutput })
          }
        }
        if (ev.type === "agent_end") setStatus("Ready")
      }
    } catch (err) {
      const errId = currentAssistantId || genId()
      updateMessage(errId, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false, role: "error" })
      setStatus("Error")
    } finally {
      setIsLoading(false); setSubmitKey((k) => k + 1)
      streamingIdRef.current = null
    }
  }, [isLoading, selectedModel, provider, selectedAgent, addMessage, updateMessage, getOrCreateAgent])

  const cmdItems = useMemo(() => buildCmdItems({
    renderer, sessionStore: sessionStore.current, sessionIdRef: sessionId,
    hasModel, selectedModel, provider, mcpCount, messagesLength: messages.length,
    showThinking, showToolCalls,
    setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setTokenUsage, setShowThinking, setShowToolCalls, setHomeKey, setNavKey, setDialogStep,
  }), [renderer, hasModel, selectedModel, provider, mcpCount, messages.length, showThinking, showToolCalls])

  const cmdFiltered = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    return !q ? cmdItems : cmdItems.filter((i) => i.label.includes(q) || i.desc.includes(q) || (i.cat && i.cat.toLowerCase().includes(q)))
  }, [cmdItems, cmdFilter])
  const execCmd = useCallback((item: any) => { item.action(); setShowCmd(false) }, [])
  useEffect(() => { if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1) }, [cmdSelected, cmdFiltered.length])

  return (
    <box flexDirection="column" height={termHeight} backgroundColor={c.bg}>
      {route === "home" ? (
        <box key={`home-${homeKey}`} flexDirection="column" flexGrow={1}>
          <box flexGrow={1} />
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            <ascii-font text="SPECTRA" font="block" color={c.accent} />
            <box height={1} />
            <PromptBar isLoading={isLoading} spinnerFrame={spinnerFrame}
              inputKey={`h-${submitKey}-${navKey}`}
              placeholder={`Ask anything... "${PLACEHOLDERS[placeholderIdx]}"`}
              onSubmit={handleSubmit} hasModel={hasModel}
              agent={selectedAgent} model={selectedModel || ""} provider={provider || ""}
              initialValue={historyIdx >= 0 ? promptHistory[historyIdx] : ""}
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
                  <text fg={c.accent}>{s.icon}</text><text fg={c.dim}>{s.label}</text>
                </box>
              ))}
            </box>
            <Tips />
          </box>
          <box flexGrow={1} />
          <box flexDirection="row" justifyContent="space-between" paddingLeft={2} paddingRight={2} height={1} marginBottom={1}>
            <box flexDirection="row" gap={4}>
              <text fg={c.dim} overflow="hidden" wrapMode="none">{cwdLabel}</text>
            </box>
            <text fg={c.dim} flexShrink={0}>Spectra Code</text>
          </box>
        </box>
      ) : (
        <>
          <box flexDirection="column" height={termHeight - 6} padding={1}><ChatArea messages={messages} showThinking={showThinking} showToolCalls={showToolCalls} /></box>
          <box height={5} paddingX={1}>
            <PromptBar isLoading={isLoading} spinnerFrame={spinnerFrame}
              inputKey={`c-${submitKey}-${navKey}`}
              placeholder="Reply..." onSubmit={handleSubmit} hasModel={hasModel}
              agent={selectedAgent} model={selectedModel || ""} provider={provider || ""}
              initialValue={historyIdx >= 0 ? promptHistory[historyIdx] : ""}
              elapsedMs={elapsedMs} tokenUsage={tokenUsage} width={termWidth - 2} />
          </box>
        </>
      )}
      {showCmd && <CommandPalette filter={cmdFilter} selected={cmdSelected} items={cmdFiltered} termWidth={termWidth} termHeight={termHeight} />}
      {dialogStep?.type === "provider" && (
        <ProviderDialog termWidth={termWidth} termHeight={termHeight} keyHandlerRef={dialogKeyHandler}
          onModelSelected={(modelId, providerId) => {
            agentRef.current = null
            setSelectedModel(modelId); setSelectedProvider(providerId); setDialogStep(null)
            saveModelConfig(modelId, providerId)
            showToast(`Model set`, "success")
          }}
          onClose={() => setDialogStep(null)}
        />
      )}
      {dialogStep?.type === "session-list" && (
        <SessionList store={sessionStore.current} termWidth={termWidth} termHeight={termHeight}
          mode={dialogStep.mode || "load"}
          onLoad={(data) => {
            const loadedMsgs: ChatMessage[] = data.messages.map((m: any) => {
              const id = genId()
              // User message
              if (m.role === "user") {
                return { id, role: "user" as const, content: typeof m.content === "string" ? m.content : "", model: data.model }
              }
              // Assistant message
              if (m.role === "assistant") {
                const blocks = Array.isArray(m.content) ? m.content.map((c: any) => {
                  if (c.type === "text") return { type: "text" as const, content: c.text || "" }
                  if (c.type === "thinking") return { type: "thinking" as const, content: c.thinking || c.content || "" }
                  if (c.type === "toolCall") return { type: "toolCall" as const, name: c.name || "", args: JSON.stringify(c.arguments || {}) }
                  return { type: "text" as const, content: "" }
                }) : []
                const textContent = blocks.filter((b: any) => b.type === "text").map((b: any) => b.content).join("\n")
                return { id, role: "assistant" as const, content: textContent, blocks, model: m.model || data.model }
              }
              // Tool result message
              if (m.role === "toolResult") {
                const toolOutput = m.content?.[0]?.text || ""
                const args = m._args || {}
                const meta = `${m.toolName}(${JSON.stringify(args)})`
                return { id, role: "tool" as const, content: toolOutput, meta }
              }
              return { id, role: "user" as const, content: "", model: data.model }
            })
            // Restore token usage from assistant messages
            let inputTokens = 0, outputTokens = 0
            for (const m of data.messages as any[]) {
              if (m.role === "assistant" && m.usage) {
                inputTokens += m.usage.input || 0
                outputTokens += m.usage.output || 0
              }
            }
            setTokenUsage({ input: inputTokens, output: outputTokens })
            setMessages(() => loadedMsgs)
            sessionId.current = data.id
            setSelectedModel(data.model)
            setSelectedProvider(data.provider || data.model.split("/")[0])
            setSelectedAgent(data.agent)
            setRoute("chat"); setDialogStep(null)
            if (agentRef.current) {
              agentRef.current.reset()
              agentRef.current.restoreHistory(data.messages)
            }
            showToast(`Loaded: ${data.title.slice(0, 40)}`, "info")
          }}
          onDelete={(id) => {
            sessionStore.current.delete(id)
            if (sessionId.current === id) {
              sessionId.current = null
              setMessages([])
              setRoute("home")
              setHomeKey((k) => k + 1)
            }
            showToast("Session deleted", "success")
          }}
          onRename={(id, title) => {
            sessionStore.current.rename(id, title)
            showToast("Session renamed", "success")
          }}
          onClose={() => setDialogStep(null)}
          registerHandler={(fn) => { dialogKeyHandler.current = fn }}
        />
      )}
      {dialogStep?.type === "switch-model" && provider && (
        <ModelSwitcher providerId={provider} termWidth={termWidth} termHeight={termHeight}
          onModelSelected={(modelId, providerId) => {
            const oldMessages = agentRef.current ? [...agentRef.current.messages] : []
            agentRef.current = null
            setSelectedModel(modelId); setSelectedProvider(providerId); setDialogStep(null)
            saveModelConfig(modelId, providerId)
            showToast(`Switched model`, "info")
          }}
          onClose={() => setDialogStep(null)}
          registerHandler={(fn) => { dialogKeyHandler.current = fn }}
        />
      )}
      <ToastContainer />
    </box>
  )
}
