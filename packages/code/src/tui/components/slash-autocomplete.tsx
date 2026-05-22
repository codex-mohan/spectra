import { useMemo } from "react"
import { c } from "../theme.js"
import type { CmdItem } from "./command-palette.js"

export interface SlashAutocompleteProps {
  query: string
  selected: number
  items: CmdItem[]
  termWidth: number
  termHeight: number
  route: "home" | "chat"
  promptTop?: number
  promptLeft?: number
  promptWidth?: number
}

const MAX_ITEMS = 8

export function SlashAutocomplete(props: SlashAutocompleteProps) {
  const { query, selected, items, termWidth, termHeight, route, promptTop, promptLeft, promptWidth } = props

  const count = Math.min(items.length, MAX_ITEMS)
  if (count === 0) return null

  const mw = Math.min(50, termWidth - 8)
  const mh = count + 4

  const isChat = route === "chat"

  const menuLeft = promptLeft ?? 3
  const menuWidth = promptWidth ?? mw

  const menuTop = isChat
    ? (promptTop ?? termHeight) - mh - 1
    : Math.floor(termHeight / 2) - mh - 2

  const rows = useMemo(() => {
    const r: any[] = []
    for (let i = 0; i < count; i++) {
      const item = items[i]
      const isSel = i === selected
      r.push(
        <box key={item.id} height={1} paddingLeft={1} paddingRight={1}
          backgroundColor={isSel ? c.bgSelect : c.bgCard}
          flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1}>
            <text fg={isSel ? c.accent : c.dim}>/{item.slashName || item.id}</text>
            {item.label && item.label !== (item.slashName || item.id) && (
              <text fg={c.subtext}>{item.label}</text>
            )}
          </box>
          <text fg={c.dim}>{item.desc}</text>
        </box>
      )
    }
    return r
  }, [items, selected, count])

  return (
    <box position="absolute" left={menuLeft} top={menuTop} width={menuWidth} height={mh}
      zIndex={100} backgroundColor={c.bgCard}>
      <box height={1} paddingLeft={1} paddingRight={1}
        flexDirection="row" justifyContent="space-between" alignItems="center">
        <box flexDirection="row" gap={1}>
          <text fg={c.accent}>/</text>
          <text fg={c.text}>{query}</text>
        </box>
        <box flexDirection="row" gap={1} height={1}>
          <text fg={c.dim}>tab</text>
        </box>
      </box>
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={c.border}>{"─".repeat(menuWidth - 2)}</text>
      </box>
      <box flexDirection="column">
        {rows}
      </box>
      {items.length > MAX_ITEMS && (
        <box height={1} paddingLeft={1}>
          <text fg={c.dim}>...{items.length - MAX_ITEMS} more</text>
        </box>
      )}
      <box height={1} paddingLeft={1} paddingRight={1}
        flexDirection="row" justifyContent="space-between">
        <text fg={c.dim}>{"\u2191\u2193"} navigate</text>
        <text fg={c.dim}>esc dismiss</text>
      </box>
    </box>
  )
}
