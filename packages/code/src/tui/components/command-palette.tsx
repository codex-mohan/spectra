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
  const mw = Math.min(56, termWidth - 4)
  const ml = Math.floor((termWidth - mw) / 2)
  const mh = Math.min(20, termHeight - 4)
  const mt = Math.max(1, Math.floor((termHeight - mh) / 2))
  const listH = mh - 4

  return (
    <box position="absolute" left={0} right={0} top={0} bottom={0} backgroundColor={c.bgOverlay}>
      <box position="absolute" left={ml} top={mt} width={mw} height={mh} backgroundColor={c.bg}>
        {/* Search bar */}
        <box paddingX={2} paddingTop={1} paddingBottom={1}>
          {prefix && <text fg={c.accent}>{prefix}</text>}
          <text fg={c.accent}>{">"}</text>
          <text fg={c.text}> {filter || "Type to filter..."}</text>
        </box>
        {/* Items */}
        <box flexDirection="column" height={listH} paddingLeft={1} paddingRight={1}>
          {items.length === 0 ? (
            <text fg={c.dim}>  No matching commands</text>
          ) : (
            items.slice(0, listH).map((item, i) => (
              <box key={item.id} backgroundColor={i === selected ? c.bgThink : undefined}>
                <text fg={i === selected ? c.accent : c.text}>
                  {item.label.padEnd(16)}
                </text>
                <text fg={c.dim}>{item.desc}</text>
              </box>
            ))
          )}
        </box>
        {/* Footer */}
        <box paddingX={2} paddingTop={1}>
          <text fg={c.dim}>{"\u2191\u2193"} navigate  {"\u23CE"} {footerHint || "select"}  esc close</text>
        </box>
      </box>
    </box>
  )
}
