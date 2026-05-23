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
import { SnapshotManager } from "../services/snapshot-manager.js"
import { readAll } from "../services/auth-store.js"
import type { AssistantMessage, Message } from "@mohanscodex/spectra-ai"
import { ProviderDialog } from "./ui/provider-dialog.js"
import { SessionList } from "./ui/session-list.js"
import { ModelSwitcher } from "./ui/model-switcher.js"
import { ManageProvidersDialog } from "./ui/manage-providers-dialog.js"
import { MessageControls } from "./ui/message-controls.js"
import { ToastContainer, showToast } from "./components/toast.js"
import clipboard from "clipboardy"
import { buildCmdItems, collectSlashNames } from "./commands.js"
import { parseSlashCommand, slashHead } from "./slash-commands.js"
import { SlashAutocomplete } from "./components/slash-autocomplete.js"
import { getGlobalConfigDir } from "../utils/paths.js"
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { join } from "path"
import { loadConfig, type CustomProviderConfig } from "../services/config.js"
import { registerAllCustomProviders } from "../services/custom-providers.js"
import { AGENT_DEFINITIONS, PRIMARY_AGENTS, filterToolsByAgent } from "../agents/definitions.js"
import { AgentRegistry } from "../agents/registry.js"

const AGENTS = PRIMARY_AGENTS
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
  const [customProviders, setCustomProviders] = useState<Record<string, CustomProviderConfig>>(() => {
    const cfg = loadConfig()
    const cp = cfg.providers || {}
    registerAllCustomProviders(cp)
    return cp
  })
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
  const [dialogStep, setDialogStep] = useState<{ type: "provider" } | { type: "session-list"; mode?: "delete" | "rename" } | { type: "switch-model" } | { type: "manage-providers" } | null>(null)
  const [placeholderIdx, setPlaceholderIdx] = useState(0)
  const [promptHistory, setPromptHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const [navKey, setNavKey] = useState(0)
  const [homeKey, setHomeKey] = useState(0)
  const [interruptKey, setInterruptKey] = useState(0)
  const [msgControls, setMsgControls] = useState<ChatMessage | null>(null)
  const [revertPoint, setRevertPoint] = useState<string | null>(null)
  const historyDraft = useRef("")
  const promptTextareaRef = useRef<any>(null)
  const [draftText, setDraftText] = useState("")
  const [slashSelected, setSlashSelected] = useState(0)
  const [promptPosition, setPromptPosition] = useState({ top: 0, left: 0, width: 0 })
  const sessionStore = useRef(new SessionStore())
  const sessionId = useRef<string | null>(null)
  const agentRef = useRef<any>(null)
  const lastAgentRef = useRef<string | null>(null)
  const dialogKeyHandler = useRef<((key: any) => void) | null>(null)
  const lastModelRef = useRef<string | null>(null)
  const isStreamingRef = useRef(false)
  const loadedSessionMessages = useRef<Message[]>([])
  const revertedMessagesRef = useRef<ChatMessage[]>([])
  const revertedSdkMessagesRef = useRef<Message[]>([])
  const revertDraftRef = useRef<string>("")
  const snapshotManager = useRef(new SnapshotManager({ workdir: process.cwd() }))
  const currentTurnStartRef = useRef<number | null>(null)
  const currentTurnMsgIdRef = useRef<string | null>(null)

  const provider = selectedProvider
  const hasModel = selectedModel !== null && selectedProvider !== null
  const mcpCount = 0
  const customProviderCount = Object.keys(customProviders).length

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
    if (dialogStep || msgControls) { dialogKeyHandler.current?.(key); return }
    if (showCmd) {
      if (key.name === "escape" || (key.ctrl && key.name === "p")) { setShowCmd(false); return }
      if (key.name === "return" || key.name === "enter") { if (cmdFiltered.length > 0) { execCmd(cmdFiltered[cmdSelected]); return }; return }
      if (key.name === "up") { setCmdSelected((p) => (p > 0 ? p - 1 : cmdFiltered.length - 1)); return }
      if (key.name === "down") { setCmdSelected((p) => (p < cmdFiltered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setCmdFilter((p) => p.slice(0, -1)); setCmdSelected(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setCmdFilter((p) => p + key.name); setCmdSelected(0); return }
      return
    }
    if (slashActive && slashFiltered.length > 0) {
      if (key.name === "escape") {
        setDraftText("")
        setSlashSelected(0)
        if (promptTextareaRef.current) {
          promptTextareaRef.current.setText("")
        }
        return
      }
      if (key.name === "tab") {
        const item = slashFiltered[slashSelected]
        if (item && promptTextareaRef.current) {
          const cmdName = item.slashName || item.id
          promptTextareaRef.current.setText(`/${cmdName} `)
          setDraftText(`/${cmdName} `)
          setSlashSelected(0)
        }
        return
      }
      if (key.name === "up") { setSlashSelected((p) => (p > 0 ? p - 1 : slashFiltered.length - 1)); return }
      if (key.name === "down") { setSlashSelected((p) => (p < slashFiltered.length - 1 ? p + 1 : 0)); return }
    }
    if (key.ctrl && key.name === "c") { renderer.destroy(); return }
    if (key.ctrl && key.name === "y") {
      if (revertPoint !== null && revertedMessagesRef.current.length > 0) {
        // Restore UI messages
        setMessages((prev) => [...prev, ...revertedMessagesRef.current])
        // Restore session store
        const sess = sessionStore.current.get(sessionId.current!)
        if (sess) {
          sess.messages = [...sess.messages, ...revertedSdkMessagesRef.current]
          sessionStore.current.save(sess)
          loadedSessionMessages.current = sess.messages
        }
        // Restore agent history
        if (agentRef.current) {
          agentRef.current.reset()
          if (loadedSessionMessages.current.length > 0) {
            agentRef.current.restoreHistory(loadedSessionMessages.current)
          }
        }
        // Clear revert state
        setRevertPoint(null)
        revertDraftRef.current = ""
        revertedMessagesRef.current = []
        revertedSdkMessagesRef.current = []
        // Clear prompt draft
        setHistoryIdx(-1)
        setNavKey((k) => k + 1)
        showToast("Messages restored", "success")
      }
      return
    }
    if (key.ctrl && key.shift && key.name === "y") {
      // File rollback: restore files to checkpoint state
      if (revertPoint !== null) {
        const result = snapshotManager.current.rollback("user requested file rollback")
        if (result.restored > 0 || result.deleted > 0) {
          showToast(`Files rolled back: ${result.restored} restored, ${result.deleted} deleted`, "success")
        } else if (result.errors.length > 0) {
          showToast(`Rollback errors: ${result.errors.map((e) => e.error).join(", ")}`, "warn")
        } else {
          showToast("No files to rollback", "info")
        }
      }
      return
    }
    if (key.name === "escape") {
      if (isStreamingRef.current) {
        if (interruptKey === 1) {
          agentRef.current?.abort()
          const duration = Math.round(performance.now() - (currentTurnStartRef.current ?? 0))
          // Mark current turn as interrupted
          if (currentTurnMsgIdRef.current) {
            updateMessage(currentTurnMsgIdRef.current, {
              turnStatus: "interrupted",
              streaming: false,
              turnDurationMs: duration,
            })
          }
          // Persist turn status + duration to session store so it survives reload
          updateLastAssistantMeta({ turnStatus: "interrupted", turnDurationMs: duration })
          setInterruptKey(0)
          return
        }
        setInterruptKey(1)
        setTimeout(() => setInterruptKey(0), 3000)
        return
      }
      return
    }
    if (key.name === "up") {
      if (slashActive) return
      if (promptHistory.length === 0) return
      if (historyIdx === -1) historyDraft.current = ""
      setHistoryIdx(Math.min(historyIdx + 1, promptHistory.length - 1)); setNavKey((k) => k + 1)
      return
    }
    if (key.name === "down") {
      if (slashActive) return
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
    const agentKey = `${selectedAgent}:${selectedModel}:${provider}`
    if (agentRef.current && lastModelRef.current === agentKey) return agentRef.current

    const existingMessages = agentRef.current
      ? [...agentRef.current.messages]
      : loadedSessionMessages.current

    const { Agent } = await import("@mohanscodex/spectra-agent")
    const { initProviders } = await import("@mohanscodex/spectra-ai")
    initProviders()
    const { createAllTools, spectraToolToAgentTool } = await import("../tools/index.js")
    const customCfg = customProviders[provider]

    const def = AGENT_DEFINITIONS[selectedAgent]
    const allTools = createAllTools().map(spectraToolToAgentTool)
    const agentTools = def ? filterToolsByAgent(allTools, selectedAgent) : allTools

    let agentsMd = ""
    try {
      const agentsPath = `${process.cwd()}/AGENTS.md`
      const { readFileSync, existsSync } = await import("fs")
      if (existsSync(agentsPath)) {
        agentsMd = readFileSync(agentsPath, "utf-8")
      }
    } catch {}

    const { getPlatformInfo } = await import("../utils/platform.js")
    const info = getPlatformInfo()

    const systemPrompt = [
      `You are Spectra Code, an AI coding agent running on ${info.os} (${info.arch}).\nDefault shell: ${info.shell}. Working directory: ${info.cwd}.`,
      agentsMd,
      def?.prompt,
    ].filter(Boolean).join("\n\n")

    agentRef.current = new Agent({
      model: {
        id: selectedModel,
        name: selectedModel,
        provider,
        api: provider,
        baseUrl: customCfg?.baseUrl,
        headers: customCfg?.headers,
      },
      systemPrompt,
      getApiKey: (p) => getAuthKey(p),
      tools: agentTools,
      maxTurns: def?.maxTurns ?? 10,
    })

    AgentRegistry.setConfig({
      model: {
        id: selectedModel,
        name: selectedModel,
        provider,
        api: provider,
        baseUrl: customCfg?.baseUrl,
        headers: customCfg?.headers,
      },
      getApiKey: (p) => getAuthKey(p),
    })

    if (existingMessages.length > 0) {
      agentRef.current.restoreHistory(existingMessages)
    }

    lastModelRef.current = agentKey
    return agentRef.current
  }, [selectedModel, provider, selectedAgent, customProviders])

  function persistMessage(sdkMsg: Message) {
    if (!sessionId.current) return
    sessionStore.current.addMessage(sessionId.current, sdkMsg)
  }

  function updateLastAssistantMeta(meta: Record<string, unknown>) {
    if (!sessionId.current) return
    const sess = sessionStore.current.get(sessionId.current)
    if (!sess) return
    for (let i = sess.messages.length - 1; i >= 0; i--) {
      const msg = sess.messages[i]
      if (msg.role === "assistant") {
        msg.metadata = { ...msg.metadata, ...meta }
        sessionStore.current.save(sess)
        return
      }
    }
  }

  const handleSubmit = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return

    const parsed = parseSlashCommand(trimmed, slashNames)
    if (parsed.type === "command") {
      const cmd = cmdItems.find((item) => {
        if (item.slashName === parsed.command.name) return true
        if (item.slashAliases?.includes(parsed.command.name)) return true
        return false
      })
      if (cmd) {
        cmd.action()
        setDraftText("")
        setSlashSelected(0)
        setSubmitKey((k) => k + 1)
        return
      }
    }

    if (!selectedModel || !provider) {
      showToast("Connect a provider to send prompts", "warn")
      setDialogStep({ type: "provider" }); return
    }

    // New message after revert permanently discards the reverted branch
    if (revertPoint !== null) {
      revertedMessagesRef.current = []
      revertedSdkMessagesRef.current = []
      revertDraftRef.current = ""
      setRevertPoint(null)
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
    isStreamingRef.current = true
    streamingIdRef.current = "pending"

    if (!sessionId.current) {
      agentRef.current = null
      lastAgentRef.current = null
      loadedSessionMessages.current = []
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
    currentTurnStartRef.current = start

    try {
      const agent = await getOrCreateAgent()

      let promptInput = trimmed
      const prevAgent = lastAgentRef.current
      if (prevAgent && prevAgent !== selectedAgent) {
        const def = AGENT_DEFINITIONS[selectedAgent]
        const prevDef = AGENT_DEFINITIONS[prevAgent]
        if (prevDef?.mode === "primary" && def?.mode === "primary") {
          if (prevAgent === "plan" && selectedAgent !== "plan") {
            promptInput = `<system-reminder>\nYou are now in ${selectedAgent} mode. The previous agent was in plan mode — a plan may have been created. Execute on it if one exists.\n</system-reminder>\n\n${trimmed}`
          } else if (selectedAgent === "plan") {
            promptInput = `<system-reminder>\nPlan mode active. You are in read-only analysis mode — do NOT make edits, do NOT run destructive commands. Use read, glob, grep, and web_fetch only. When done, call plan_exit so the user can switch to build mode.\n</system-reminder>\n\n${trimmed}`
          } else {
            promptInput = `<system-reminder>\nYou are now in ${selectedAgent} mode (was ${prevAgent}). Your available tools and behavior have changed to match this mode.\n</system-reminder>\n\n${trimmed}`
          }
        }
      }
      lastAgentRef.current = selectedAgent

      for await (const ev of agent.run(promptInput)) {
        if (ev.type === "message_start" && ev.message.role === "assistant") {
          const newId = genId()
          currentAssistantId = newId
          currentTurnMsgIdRef.current = newId
          streamingIdRef.current = newId
          addMessage({ id: newId, role: "assistant", content: "", blocks: [], streaming: true, model: selectedModel, agent: selectedAgent })
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
              addMessage({ id: tuiId, role: "tool", content: "", meta: `${tc.name}(${JSON.stringify(tc.arguments || {})})`, agent: selectedAgent })
            }
          }
        }
        if (ev.type === "message_end" && ev.message.role === "assistant" && currentAssistantId) {
          const m = ev.message as AssistantMessage
          const blocks = getMessageBlocks(m)
          const textContent = blocks.filter((b): b is ContentBlock & { type: "text" } => b.type === "text").map((b) => b.content).join("\n")
          const duration = performance.now() - (currentTurnStartRef.current ?? start)
          updateMessage(currentAssistantId, {
            content: textContent,
            blocks,
            streaming: false,
            turnTokens: { input: m.usage.input, output: m.usage.output },
            turnDurationMs: Math.round(duration),
          })
          // Persist with turn metadata so it survives session reload
          persistMessage({
            ...m,
            metadata: {
              ...m.metadata,
              turnDurationMs: Math.round(duration),
              turnTokens: { input: m.usage.input, output: m.usage.output },
            }
          })
          const e = performance.now() - start; setElapsedMs(e)
          const ot = m.usage.output
          if (ot > 0 && e > 0) setTokPerSec(ot / (e / 1000))
          setTokenUsage((p) => ({ input: p.input + m.usage.input, output: p.output + ot }))
          currentAssistantId = null
          streamingIdRef.current = null
        }
        if (ev.type === "tool_execution_start") {
          // Snapshot files before tool edits them (for checkpointing)
          if (ev.args && typeof ev.args === "object") {
            const args = ev.args as Record<string, unknown>
            const filePath = (args.path || args.file_path || args.filePath) as string | undefined
            if (filePath && typeof filePath === "string") {
              snapshotManager.current.note(filePath)
            }
          }
          if (!shownToolCalls.current.has(ev.toolCallId)) {
            shownToolCalls.current.add(ev.toolCallId)
            toolArgsMap.current.set(ev.toolCallId, ev.args)
            const tuiId = genId()
            toolMsgMap.current.set(ev.toolCallId, tuiId)
            addMessage({ id: tuiId, role: "tool", content: "", meta: `${ev.toolName}(${JSON.stringify(ev.args || {})})`, agent: selectedAgent })
          }
        }
        if (ev.type === "tool_execution_end") {
          const args = toolArgsMap.current.get(ev.toolCallId) || {}
          const resultDetails = (ev.result?.details as Record<string, unknown> | undefined) ?? {}
          const toolMsg: Message = {
            role: "toolResult",
            toolCallId: ev.toolCallId,
            toolName: ev.toolName,
            content: ev.result?.content || [],
            details: { args, ...resultDetails },
            isError: ev.isError || false,
            timestamp: Date.now(),
          }
          persistMessage(toolMsg)
          // Update the existing inline tool message with output
          const tuiId = toolMsgMap.current.get(ev.toolCallId)
          if (tuiId) {
            const toolOutput = ev.result?.content?.[0]?.text || ""
            const exitCode = typeof resultDetails.exitCode === "number" ? resultDetails.exitCode : undefined
            updateMessage(tuiId, { content: toolOutput, exitCode })
          }
        }
        if (ev.type === "agent_end") {
          setStatus("Ready")
          // Mark the turn as completed
          if (currentTurnMsgIdRef.current) {
            updateMessage(currentTurnMsgIdRef.current, { turnStatus: "completed" })
          }
          // Persist turn status to session store so it survives reload
          updateLastAssistantMeta({ turnStatus: "completed" })
        }
      }
    } catch (err) {
      const errId = currentAssistantId || genId()
      updateMessage(errId, { content: `Error: ${err instanceof Error ? err.message : String(err)}`, streaming: false, role: "error" })
      // Mark the turn as errored if there was an assistant message
      if (currentTurnMsgIdRef.current) {
        updateMessage(currentTurnMsgIdRef.current, { turnStatus: "error", streaming: false })
      }
      // Persist turn status to session store so it survives reload
      updateLastAssistantMeta({ turnStatus: "error" })
      setStatus("Error")
    } finally {
      // Commit file checkpoint for this turn
      if (snapshotManager.current.isActive()) {
        snapshotManager.current.commit()
      }
      setIsLoading(false); setSubmitKey((k) => k + 1); setInterruptKey(0)
      isStreamingRef.current = false
      streamingIdRef.current = null
      currentTurnStartRef.current = null
      currentTurnMsgIdRef.current = null
    }
  }, [isLoading, selectedModel, provider, selectedAgent, addMessage, updateMessage, getOrCreateAgent, revertPoint])

  const cmdItems = useMemo(() => buildCmdItems({
    renderer, sessionStore: sessionStore.current, sessionIdRef: sessionId,
    hasModel, selectedModel, provider, mcpCount, customProviderCount, messagesLength: messages.length,
    showThinking, showToolCalls,
    setRoute, setMessages, setStatus, setElapsedMs, setTokPerSec, setTokenUsage, setShowThinking, setShowToolCalls, setHomeKey, setNavKey, setDialogStep,
  }), [renderer, hasModel, selectedModel, provider, mcpCount, customProviderCount, messages.length, showThinking, showToolCalls])

  const cmdFiltered = useMemo(() => {
    const q = cmdFilter.toLowerCase()
    return !q ? cmdItems : cmdItems.filter((i) => i.label.includes(q) || i.desc.includes(q) || (i.cat && i.cat.toLowerCase().includes(q)))
  }, [cmdItems, cmdFilter])
  const execCmd = useCallback((item: any) => { item.action(); setShowCmd(false) }, [])
  useEffect(() => { if (cmdSelected >= cmdFiltered.length && cmdFiltered.length > 0) setCmdSelected(cmdFiltered.length - 1) }, [cmdSelected, cmdFiltered.length])

  const slashNames = useMemo(() => collectSlashNames(cmdItems), [cmdItems])
  const slashFiltered = useMemo(() => {
    const head = slashHead(draftText)
    if (!head) return [] as CmdItem[]
    const q = head.name.toLowerCase()
    if (!q) return cmdItems
    return cmdItems.filter((item) => {
      if (item.slashName && item.slashName.toLowerCase().includes(q)) return true
      if (item.slashAliases) return item.slashAliases.some((a) => a.toLowerCase().includes(q))
      return false
    })
  }, [cmdItems, draftText])
  const slashActive = useMemo(() => slashHead(draftText) !== undefined, [draftText])
  useEffect(() => { setSlashSelected(0) }, [draftText])

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
              initialValue={revertDraftRef.current || (historyIdx >= 0 ? promptHistory[historyIdx] : "")}
              width={Math.min(68, termWidth - 8)}
              focused={!dialogStep && !showCmd && !msgControls}
              onTextChange={(t) => setDraftText(t)}
              onGetTextarea={(r) => { promptTextareaRef.current = r }}
              onPositionChange={setPromptPosition} />
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
        <box flexDirection="column" height={termHeight} paddingLeft={2} paddingRight={2}>
          {revertPoint && (
            <box flexDirection="column" alignItems="center" paddingY={1}>
              <box flexDirection="row">
                <text fg={c.warn}>Messages reverted. </text>
                <text fg={c.accent}>Ctrl+Y</text>
                <text fg={c.dim}> to restore</text>
              </box>
              <box flexDirection="row">
                <text fg={c.dim}>Files unchanged. </text>
                <text fg={c.accent}>Ctrl+Shift+Y</text>
                <text fg={c.dim}> to rollback files</text>
              </box>
            </box>
          )}
          <box flexDirection="column" flexGrow={1} paddingBottom={1}>
            <ChatArea messages={messages} showThinking={showThinking} showToolCalls={showToolCalls}
              revertPoint={revertPoint}
              onMessageClick={(msg) => setMsgControls(msg)} />
          </box>
          <box flexShrink={0}>
            <PromptBar isLoading={isLoading} spinnerFrame={spinnerFrame}
              inputKey={`c-${submitKey}-${navKey}`}
              placeholder="Reply..." onSubmit={handleSubmit} hasModel={hasModel}
              agent={selectedAgent} model={selectedModel || ""} provider={provider || ""}
              initialValue={revertDraftRef.current || (historyIdx >= 0 ? promptHistory[historyIdx] : "")}
              elapsedMs={elapsedMs} tokenUsage={tokenUsage} width={termWidth - 4}
              isChatView={true} showInterruptHint={interruptKey === 1}
              focused={!dialogStep && !showCmd && !msgControls}
              onTextChange={(t) => setDraftText(t)}
              onGetTextarea={(r) => { promptTextareaRef.current = r }}
              onPositionChange={setPromptPosition} />
          </box>
        </box>
      )}
      {showCmd && <CommandPalette filter={cmdFilter} selected={cmdSelected} items={cmdFiltered} termWidth={termWidth} termHeight={termHeight} />}
      {slashActive && slashFiltered.length > 0 && (
        <SlashAutocomplete query={slashHead(draftText)?.name || ""} selected={slashSelected}
          items={slashFiltered} termWidth={termWidth} termHeight={termHeight} route={route}
          promptTop={promptPosition.top} promptLeft={promptPosition.left} promptWidth={promptPosition.width} />
      )}
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
                const metadata = m.metadata || {}
                const turnTokens = metadata.turnTokens || (m.usage ? { input: m.usage.input || 0, output: m.usage.output || 0 } : undefined)
                return {
                  id, role: "assistant" as const, content: textContent, blocks,
                  model: m.model || data.model,
                  turnStatus: metadata.turnStatus as "completed" | "interrupted" | "error" | undefined,
                  turnDurationMs: metadata.turnDurationMs as number | undefined,
                  turnTokens,
                  agent: data.agent,
                }
              }
              // Tool result message
              if (m.role === "toolResult") {
                const toolOutput = m.content?.[0]?.text || ""
                const args = (m as any).details?.args || {}
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
            // Store SDK messages for agent history
            loadedSessionMessages.current = data.messages as unknown as Message[]
            if (agentRef.current) {
              agentRef.current.reset()
              agentRef.current.restoreHistory(data.messages as unknown as Message[])
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
      {dialogStep?.type === "switch-model" && (
        <ModelSwitcher providerId={provider || ""} termWidth={termWidth} termHeight={termHeight}
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
      {dialogStep?.type === "manage-providers" && (
        <ManageProvidersDialog termWidth={termWidth} termHeight={termHeight}
          providers={customProviders}
          onProvidersChange={(updated) => {
            setCustomProviders(updated)
            agentRef.current = null
            showToast("Providers updated", "success")
          }}
          onClose={() => setDialogStep(null)}
          registerHandler={(fn) => { dialogKeyHandler.current = fn }}
        />
      )}
      {msgControls && sessionId.current && (
        <MessageControls
          message={msgControls}
          sessionId={sessionId.current}
          messages={messages}
          termWidth={termWidth}
          termHeight={termHeight}
          revertPoint={revertPoint}
          onRevert={(msgId) => {
            const msgIdx = messages.findIndex(m => m.id === msgId)
            if (msgIdx < 0) { setMsgControls(null); return }

            // Walk back to find the target user message
            let targetIdx = msgIdx
            while (targetIdx >= 0 && messages[targetIdx].role !== "user") {
              targetIdx--
            }
            if (targetIdx < 0) {
              showToast("Cannot revert: no user message found", "warn")
              setMsgControls(null)
              return
            }

            // Discard any previous reverted branch (chained revert)
            const targetMsg = messages[targetIdx]
            const keptMessages = messages.slice(0, targetIdx)
            const removedMessages = messages.slice(targetIdx)

            // Store for potential redo
            revertedMessagesRef.current = removedMessages
            setRevertPoint(targetMsg.id)
            revertDraftRef.current = targetMsg.content

            // Update UI
            setMessages(keptMessages)

            // Update session store
            const sess = sessionStore.current.get(sessionId.current!)
            if (sess) {
              const keptSdkMessages = sess.messages.slice(0, targetIdx)
              revertedSdkMessagesRef.current = sess.messages.slice(targetIdx)
              sess.messages = keptSdkMessages
              sessionStore.current.save(sess)
              loadedSessionMessages.current = keptSdkMessages
            }

            // Reset agent history to the kept messages
            if (agentRef.current) {
              agentRef.current.reset()
              if (loadedSessionMessages.current.length > 0) {
                agentRef.current.restoreHistory(loadedSessionMessages.current)
              }
            }

            // Reset prompt state and force re-render with revert draft
            setHistoryIdx(-1)
            setNavKey((k) => k + 1)

            showToast("Reverted — Ctrl+Y to redo", "success")
            setMsgControls(null)
          }}
          onRedo={() => {
            if (revertedMessagesRef.current.length === 0) {
              setMsgControls(null)
              return
            }

            // Restore UI messages
            setMessages((prev) => [...prev, ...revertedMessagesRef.current])

            // Restore session store
            const sess = sessionStore.current.get(sessionId.current!)
            if (sess) {
              sess.messages = [...sess.messages, ...revertedSdkMessagesRef.current]
              sessionStore.current.save(sess)
              loadedSessionMessages.current = sess.messages
            }

            // Restore agent history
            if (agentRef.current) {
              agentRef.current.reset()
              if (loadedSessionMessages.current.length > 0) {
                agentRef.current.restoreHistory(loadedSessionMessages.current)
              }
            }

            // Clear revert state
            setRevertPoint(null)
            revertDraftRef.current = ""
            revertedMessagesRef.current = []
            revertedSdkMessagesRef.current = []

            // Clear prompt draft
            setHistoryIdx(-1)
            setNavKey((k) => k + 1)

            showToast("Messages restored", "success")
            setMsgControls(null)
          }}
          onFork={(msgId) => {
            const forked = sessionStore.current.fork(sessionId.current!)
            if (forked) {
              // Trim forked session to the selected message
              const msgIdx = messages.findIndex(m => m.id === msgId)
              if (msgIdx >= 0) {
                forked.messages = forked.messages.slice(0, msgIdx + 1)
                forked.title = `${forked.title.split(" (fork)")[0]} (fork)`
                sessionStore.current.save(forked)
              }
              // Load the forked session
              const data = sessionStore.current.get(forked.id)
              if (data) {
                const loadedMsgs: ChatMessage[] = data.messages.map((m: any) => {
                  const id = genId()
                  if (m.role === "user") {
                    return { id, role: "user" as const, content: typeof m.content === "string" ? m.content : "", model: data.model }
                  }
                  if (m.role === "assistant") {
                    const blocks = Array.isArray(m.content) ? m.content.map((c: any) => {
                      if (c.type === "text") return { type: "text" as const, content: c.text || "" }
                      if (c.type === "thinking") return { type: "thinking" as const, content: c.thinking || c.content || "" }
                      if (c.type === "toolCall") return { type: "toolCall" as const, name: c.name || "", args: JSON.stringify(c.arguments || {}) }
                      return { type: "text" as const, content: "" }
                    }) : []
                    const textContent = blocks.filter((b: any) => b.type === "text").map((b: any) => b.content).join("\n")
                    const metadata = m.metadata || {}
                    const turnTokens = metadata.turnTokens || (m.usage ? { input: m.usage.input || 0, output: m.usage.output || 0 } : undefined)
                    return {
                      id, role: "assistant" as const, content: textContent, blocks,
                      model: m.model || data.model,
                      turnStatus: metadata.turnStatus as "completed" | "interrupted" | "error" | undefined,
                      turnDurationMs: metadata.turnDurationMs as number | undefined,
                      turnTokens,
                      agent: data.agent,
                    }
                  }
                  if (m.role === "toolResult") {
                    const toolOutput = m.content?.[0]?.text || ""
                    const args = (m as any).details?.args || {}
                    const meta = `${m.toolName}(${JSON.stringify(args)})`
                return { id, role: "tool" as const, content: toolOutput, meta, agent: data.agent }
                  }
                  return { id, role: "user" as const, content: "", model: data.model }
                })
                setMessages(loadedMsgs)
                sessionId.current = forked.id
                loadedSessionMessages.current = data.messages as unknown as Message[]
                showToast("Session forked", "success")
              }
            }
            setMsgControls(null)
          }}
          onClose={() => setMsgControls(null)}
          registerHandler={(fn) => { dialogKeyHandler.current = fn }}
        />
      )}
      <ToastContainer />
    </box>
  )
}
