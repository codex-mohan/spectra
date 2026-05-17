import { c } from "../theme.js"

export interface CmdItem {
  id: string
  label: string
  desc: string
  cat?: string
  action: () => void
}

export interface CommandPaletteProps {
  filter: string
  selected: number
  items: CmdItem[]
  termWidth: number
  termHeight: number
  prefix?: string
  footerHint?: string
}

export function CommandPalette(props: CommandPaletteProps) {
  const { filter, selected, items, termWidth, termHeight, prefix, footerHint } = props

  const mw = Math.min(64, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(22, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const innerW = mw - 4
  const listH = mh - 5 // title + sep + footer + padding

  // Build flat rows with category headers inserted
  const rows = []
  let prevCat = ""
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.cat && item.cat !== prevCat) {
      if (rows.length > 0) {
        rows.push(<box key={`spacer-${i}`} height={1} />)
      }
      rows.push(
        <box key={`cat-${item.cat}`} height={1} paddingX={1}>
          <text fg={c.warn}><strong>{item.cat}</strong></text>
        </box>
      )
      prevCat = item.cat
    }
    const isSelected = i === selected
    rows.push(
      <box
        key={item.id}
        height={1}
        paddingX={1}
        backgroundColor={isSelected ? c.bgSelect : undefined}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <text fg={isSelected ? c.accent : c.text}>{item.label}</text>
        <text fg={c.dim}>{item.desc}</text>
      </box>
    )
  }

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bgCard}>
        {/* Title bar */}
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="space-between" alignItems="center">
          <box flexDirection="row" gap={1} alignItems="center">
            {prefix ? <text fg={c.accent}>{prefix}</text> : null}
            <text fg={c.accent}>{">"}</text>
            <text fg={c.text}>{filter || "Type to filter..."}</text>
          </box>
          <box>
            <text fg={c.dim}>esc</text>
          </box>
        </box>

        <box height={1} />

        {/* Separator */}
        <box height={1} paddingX={2}>
          <text fg={c.border}>{"─".repeat(innerW)}</text>
        </box>

        {/* Items list */}
        <box flexDirection="column" height={listH} paddingX={1}>
          {rows.length === 0 ? (
            <box height={1} paddingX={1}>
              <text fg={c.dim}>No matching commands</text>
            </box>
          ) : (
            rows.slice(0, listH)
          )}
        </box>

        {/* Footer */}
        <box height={1} paddingX={2} paddingTop={1} flexDirection="row" justifyContent="center">
          <text fg={c.dim}>{"\u2191\u2193"} navigate · {"\u23CE"} {footerHint || "select"} · esc close</text>
        </box>
      </box>
    </box>
  )
}
