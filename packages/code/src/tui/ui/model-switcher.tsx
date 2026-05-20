import { useState, useEffect, useMemo, useRef } from "react"
import { c } from "../theme.js"
import { listProviders, getModels } from "@singularity-ai/spectra-ai"
import { loadConfig } from "../../services/config.js"

export interface ModelSwitcherProps {
  providerId: string
  termWidth: number; termHeight: number
  onModelSelected: (modelId: string, providerId: string) => void
  onClose: () => void
  registerHandler: (fn: ((key: any) => void) | null) => void
}

interface ModelEntry {
  id: string
  name: string
  provider: string
  providerName: string
}

const POPULAR_PROVIDERS = ["anthropic", "openai", "openrouter", "groq", "google", "xai", "deepseek", "mistral"]

export function ModelSwitcher(props: ModelSwitcherProps) {
  const { providerId, termWidth, termHeight, onModelSelected, onClose, registerHandler } = props
  const [allModels, setAllModels] = useState<ModelEntry[]>([])
  const [filter, setFilter] = useState("")
  const [sel, setSel] = useState(0)
  const scrollRef = useRef<any>(null)

  useEffect(() => {
    const cfg = loadConfig()
    const customProviders = cfg.providers || {}
    const builtinIds = listProviders()
    const collected: ModelEntry[] = []

    const promises = builtinIds.map((id) =>
      getModels(id).then((models) => {
        for (const m of models) {
          collected.push({ id: m.id, name: m.name, provider: id, providerName: id })
        }
      })
    )

    for (const [id, pcfg] of Object.entries(customProviders)) {
      if (pcfg.models) {
        for (const [modelId, meta] of Object.entries(pcfg.models)) {
          collected.push({ id: modelId, name: meta.name || modelId, provider: id, providerName: pcfg.name || id })
        }
      }
    }

    Promise.all(promises).then(() => {
      setAllModels(collected)
      const currentIdx = collected.findIndex(m => m.provider === providerId)
      setSel(currentIdx >= 0 ? currentIdx : 0)
    })
  }, [providerId])

  const filtered = useMemo(() => {
    const q = filter.toLowerCase()
    if (!q) return allModels
    return allModels.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.provider.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q)
    )
  }, [filter, allModels])

  useEffect(() => {
    registerHandler((key: any) => {
      if (key.name === "escape") { onClose(); return }
      if (key.name === "return" || key.name === "enter") {
        if (filtered.length > 0 && filtered[sel]) { onModelSelected(filtered[sel].id, filtered[sel].provider); onClose(); return }
        return
      }
      if (key.name === "up") { setSel((p) => (p > 0 ? p - 1 : filtered.length - 1)); return }
      if (key.name === "down") { setSel((p) => (p < filtered.length - 1 ? p + 1 : 0)); return }
      if (key.name === "backspace") { setFilter((p) => p.slice(0, -1)); setSel(0); return }
      if (key.name.length === 1 && !key.ctrl && !key.meta) { setFilter((p) => p + key.name); setSel(0); return }
    })
    return () => registerHandler(null)
  }, [filtered, sel, onModelSelected, onClose, registerHandler])

  useEffect(() => {
    const el = scrollRef.current
    if (el && typeof el.scrollChildIntoView === "function" && filtered[sel]) {
      el.scrollChildIntoView(`${filtered[sel].provider}-${filtered[sel].id}`)
    }
  }, [sel, filtered])

  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 5

  const rows = useMemo(() => {
    const r: any[] = []
    let prevProvider = ""
    for (let i = 0; i < filtered.length; i++) {
      const m = filtered[i]
      const isPopular = POPULAR_PROVIDERS.includes(m.provider)
      const cat = isPopular ? "Popular" : m.providerName
      if (cat !== prevProvider) {
        if (prevProvider) r.push(<box key={`gap-${cat}-${i}`} height={1} backgroundColor={c.bgCard} />)
        prevProvider = cat
        r.push(
          <box key={`cat-${cat}-${i}`} height={1} paddingLeft={2} backgroundColor={c.bgCard}>
            <text fg={c.warn} attributes={1}>{cat}</text>
          </box>
        )
      }
      const isSelected = i === sel
      r.push(
        <box key={`${m.provider}-${m.id}`} id={`${m.provider}-${m.id}`} height={1} paddingX={1}
          backgroundColor={isSelected ? c.bgSelect : c.bgCard}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <text fg={isSelected ? c.accent : c.text} overflow="hidden" wrapMode="none" flexGrow={1} paddingLeft={1}>
            {m.name}
          </text>
          <text fg={c.dim} flexShrink={0}>{m.id}</text>
        </box>
      )
    }
    return r
  }, [filtered, sel])

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        <box paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
          <box flexDirection="row" gap={1}>
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || "Search all models..."}</text>
          </box>
          <box flexDirection="row" height={1}>
            <text fg={c.dim}>esc</text>
          </box>
        </box>
        <box height={1} />
        <box height={1} paddingX={2}><text fg={c.border}>{"─".repeat(mw - 4)}</text></box>
        <scrollbox ref={(r: any) => { scrollRef.current = r }}
          paddingX={1} maxHeight={listH} scrollY={true}
          scrollbarOptions={{ visible: false }}>
          <box flexDirection="column">
            {rows.length === 0
              ? <box height={1} paddingX={1} backgroundColor={c.bgCard}><text fg={c.dim}>No models</text></box>
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
