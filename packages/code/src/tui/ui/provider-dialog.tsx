import { useState, useMemo, useRef, useEffect, useCallback } from "react"
import { c } from "../theme.js"
import { write, type ApiCredential } from "../../services/auth-store.js"
import { getGlobalConfigDir } from "../../utils/paths.js"
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "fs"
import { join } from "path"

const PROVIDERS = [
  { id: "anthropic", name: "Anthropic", desc: "Claude models", popular: true },
  { id: "openai", name: "OpenAI", desc: "GPT models", popular: true },
  { id: "openrouter", name: "OpenRouter", desc: "Multi-model access", popular: true },
  { id: "groq", name: "Groq", desc: "Fast inference", popular: true },
  { id: "google", name: "Google", desc: "Gemini models", popular: true },
  { id: "deepseek", name: "DeepSeek", desc: "DeepSeek models" },
  { id: "mistral", name: "Mistral", desc: "Mistral models" },
  { id: "github-copilot", name: "GitHub Copilot", desc: "Copilot models" },
  { id: "together", name: "Together AI", desc: "Open-source models" },
  { id: "fireworks", name: "Fireworks AI", desc: "Fast inference" },
]

const MODELS: Record<string, { id: string; name: string }[]> = {
  anthropic: [
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku" },
  ],
  openai: [
    { id: "openai/gpt-4o", name: "GPT-4o" },
    { id: "openai/gpt-4o-mini", name: "GPT-4o mini" },
  ],
  openrouter: [
    { id: "openrouter/anthropic/claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "openrouter/openai/gpt-4o", name: "GPT-4o" },
  ],
  groq: [
    { id: "groq/llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
    { id: "groq/llama-3-3-70b-versatile", name: "Llama 3.3 70B" },
  ],
  google: [
    { id: "google/gemini-2.5-pro-exp-03-25", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash-preview-04-17", name: "Gemini 2.5 Flash" },
  ],
  deepseek: [
    { id: "deepseek/deepseek-chat", name: "DeepSeek V3" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek R1" },
  ],
  mistral: [
    { id: "mistral/mistral-large-2411", name: "Mistral Large" },
    { id: "mistral/mistral-small-2501", name: "Mistral Small" },
  ],
}

// ── Shared select list (used by both provider and model picking) ──

function SelectDialog(props: {
  items: { id: string; name: string; desc: string; cat?: string }[]
  title: string
  placeholder: string
  onSelect: (id: string, name: string) => void
  onCancel: () => void
  termWidth: number
  termHeight: number
}) {
  const { items, placeholder, onSelect, onCancel, termWidth, termHeight } = props
  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 5
  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const scrollRef = useRef<any>(null)

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q) || i.id.includes(q) || i.desc.includes(q))
  }, [filter, items])

  // Build rows with category headers
  const rows = useMemo(() => {
    const r: any[] = []
    let prevCat = ""
    for (let i = 0; i < filtered.length; i++) {
      const it = filtered[i]
      const cat = it.cat || ""
      if (cat && cat !== prevCat) {
        if (prevCat) r.push(<box key={`gap-${cat}`} height={1} backgroundColor={c.bgCard} />)
        prevCat = cat
        r.push(<box key={`cat-${cat}`} height={1} paddingLeft={2} backgroundColor={c.bgCard}>
          <text fg={c.warn} attributes={1}>{cat}</text>
        </box>)
      }
      r.push(
        <box key={it.id} height={1} paddingX={1}
          backgroundColor={i === sel ? c.bgSelect : c.bgCard}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={i === sel ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
            {it.name}
          </text>
          <text fg={c.dim} flexShrink={0}>{it.desc}</text>
        </box>
      )
    }
    return r
  }, [filtered, sel])

  // Expose keyboard handler for the app to call
  const handleKey = useCallback((key: { name: string; ctrl: boolean; meta: boolean }) => {
    if (key.name === "escape") { onCancel(); return }
    if (key.name === "return" || key.name === "enter") {
      if (filtered.length > 0) { onSelect(filtered[sel].id, filtered[sel].name); return }
      return
    }
    if (key.name === "up") { setSel((p) => (p > 0 ? p - 1 : filtered.length - 1)); return }
    if (key.name === "down") { setSel((p) => (p < filtered.length - 1 ? p + 1 : 0)); return }
    if (key.name === "backspace") { setFilter((p) => p.slice(0, -1)); setSel(0); return }
    if (key.name.length === 1 && !key.ctrl && !key.meta) { setFilter((p) => p + key.name); setSel(0); return }
  }, [filtered, sel, onSelect, onCancel])

  // Register keyboard handler on mount
  useEffect(() => {
    const handler = (key: any) => handleKey(key)
    // Store the handler so the app can call it
    ;(window as any).__dialogKeyHandler = handler
    // Clean up by restoring no-op
    return () => { (window as any).__dialogKeyHandler = undefined }
  }, [handleKey])

  useEffect(() => {
    const el = scrollRef.current
    if (el && typeof el.scrollChildIntoView === "function" && filtered[sel]) el.scrollChildIntoView(filtered[sel].id)
  })

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box height={1} paddingX={2} paddingTop={1}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1}>
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || placeholder}</text>
          </box>
          <text fg={c.dim}>esc</text>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}><text fg={c.border}>{"─".repeat(mw - 4)}</text></box>
        <scrollbox ref={(r: any) => { scrollRef.current = r }}
          paddingX={1} maxHeight={listH} scrollY={true}
          verticalScrollbarOptions={{ trackOptions: { backgroundColor: c.bgCard, foregroundColor: c.bgCard } }}>
          <box flexDirection="column">
            {rows.length === 0
              ? <box height={1} paddingX={1} backgroundColor={c.bgCard}><text fg={c.dim}>No matches</text></box>
              : rows}
          </box>
        </scrollbox>
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} select · esc close</text>
        </box>
      </box>
    </box>
  )
}

// ── API key input dialog ──

function ApiKeyDialog(props: {
  providerName: string
  providerId: string
  onSubmit: (key: string) => void
  onCancel: () => void
  termWidth: number
  termHeight: number
}) {
  const { providerName, providerId, onSubmit, onCancel, termWidth, termHeight } = props
  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = 10
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [err, setErr] = useState("")

  const keyDoneRef = useRef(false)

  const desc: Record<string, string> = {
    anthropic: "Get your key at https://console.anthropic.com",
    openai: "Get your key at https://platform.openai.com",
    openrouter: "Get your key at https://openrouter.ai/keys",
    groq: "Get your key at https://console.groq.com",
    google: "Get your key at https://aistudio.google.com/apikey",
    deepseek: "Get your key at https://platform.deepseek.com",
  }

  const handleSubmit = (value: string) => {
    const val = String(value).trim()
    if (!val || keyDoneRef.current) return
    keyDoneRef.current = true
    setBusy(true)
    try {
      const configDir = getGlobalConfigDir()
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true })
      const configPath = join(configDir, "spectra.json")
      let cfg: Record<string, unknown> = {}
      try { cfg = JSON.parse(readFileSync(configPath, "utf-8")) } catch {}
      cfg.provider = providerId
      cfg.apiKey = val
      writeFileSync(configPath, JSON.stringify(cfg, null, 2), { mode: 0o600, encoding: "utf-8" })
      // Also write to auth store (matching opencode's auth.json pattern)
      write(providerId, { type: "api", key: val } as ApiCredential)
      setDone(true)
      setTimeout(() => onSubmit(val), 400)
    } catch (e) { setErr(String(e)); setBusy(false); keyDoneRef.current = false }
  }

  // Register keyboard handler for enter/escape
  useEffect(() => {
    const handler = (key: any) => {
      if (key.name === "escape" && !keyDoneRef.current) { onCancel(); return }
    }
    ;(window as any).__dialogKeyHandler = handler
    return () => { (window as any).__dialogKeyHandler = undefined }
  }, [onCancel])

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}
        padding={2} flexDirection="column" gap={1}>
        <text fg={c.accent} attributes={1}>{providerName} API Key</text>
        <text fg={c.dim}>{desc[providerId] || `Enter your ${providerName} API key`}</text>
        <box flexDirection="row" alignItems="center" gap={1}>
          <text fg={c.accent}>›</text>
          <box flexGrow={1}>
              <input key="apikey-input" placeholder="sk-..."
                onSubmit={(v) => handleSubmit(String(v))} focused={true} />
          </box>
        </box>
        {done && <text fg={c.success}>✓ Saved</text>}
        {busy && !done && <text fg={c.dim}>Saving...</text>}
        {err && <text fg={c.error}>{err}</text>}
      </box>
    </box>
  )
}

// ── Root: orchestrates the 3-step flow ──

export interface ProviderDialogProps {
  termWidth: number
  termHeight: number
  onModelSelected: (modelId: string) => void
  onClose: () => void
}

type Step =
  | { phase: "provider-list" }
  | { phase: "api-key"; id: string; name: string }
  | { phase: "model-select"; id: string; name: string }

export function ProviderDialog(props: ProviderDialogProps) {
  const { termWidth, termHeight, onModelSelected, onClose } = props
  const [step, setStep] = useState<Step>({ phase: "provider-list" })

  if (step.phase === "provider-list") {
    const items = PROVIDERS.map((p) => ({
      id: p.id, name: p.name, desc: p.desc,
      cat: p.popular ? "Popular" : "Providers",
    }))
    return (
      <SelectDialog
        items={items} title="Connect a provider" placeholder="Search providers..."
        termWidth={termWidth} termHeight={termHeight}
        onSelect={(id, name) => setStep({ phase: "api-key", id, name })}
        onCancel={onClose}
      />
    )
  }

  if (step.phase === "api-key") {
    return (
      <ApiKeyDialog
        providerName={step.name} providerId={step.id}
        termWidth={termWidth} termHeight={termHeight}
        onSubmit={() => setStep({ phase: "model-select", id: step.id, name: step.name })}
        onCancel={onClose}
      />
    )
  }

  if (step.phase === "model-select") {
    const models = MODELS[step.id] || []
    const items = models.map((m) => ({ id: m.id, name: m.name, desc: "", cat: "Models" }))
    return (
      <SelectDialog
        items={items} title="Choose a model" placeholder="Search models..."
        termWidth={termWidth} termHeight={termHeight}
        onSelect={(id) => { onModelSelected(id); onClose() }}
        onCancel={onClose}
      />
    )
  }

  return null
}
