import { useRef } from "react"
import { c, SPINNER } from "./theme.js"

export interface PromptBarProps {
  isLoading: boolean
  spinnerFrame: number
  inputKey: string | number
  placeholder: string
  onSubmit: (text: string) => void
  hasModel: boolean
  agent: string
  model: string
  provider: string
  initialValue?: string
  width?: number | "auto"
  elapsedMs?: number | null
  tokenUsage?: { input: number; output: number }
}

export function PromptBar(props: PromptBarProps) {
  const { isLoading, spinnerFrame, inputKey, placeholder, onSubmit, hasModel, agent, model, provider, initialValue, width, elapsedMs, tokenUsage } = props
  const textareaRef = useRef<any>(null)

  if (!hasModel && !isLoading) {
    return (
      <box flexDirection="row">
        <box width={1} backgroundColor={c.accent} height={"auto"} />
        <box flexDirection="row" alignItems="center" backgroundColor={c.bgBar}
          paddingLeft={1} paddingRight={2} paddingTop={1} paddingBottom={1}
          width={width ?? "auto"}>
          <text fg={c.warn}>●</text>
          <text fg={c.dim}> Connect a provider to get started — </text>
          <text fg={c.accent}>Ctrl+P</text>
          <text fg={c.dim}> → connect provider</text>
        </box>
      </box>
    )
  }

  return (
    <box flexDirection="row">
      <box width={1} backgroundColor={c.accent} height={"auto"} />
      <box flexDirection="row" alignItems="center" backgroundColor={c.bgBar}
        paddingLeft={1} paddingRight={2} paddingTop={1} paddingBottom={1}
        width={width ?? "auto"}>
        <box flexDirection="column" flexGrow={1} paddingLeft={1}>
          <box minHeight={1} maxHeight={6}>
            {isLoading ? (
              <text fg={c.warn}>{SPINNER[spinnerFrame]}  Thinking...</text>
            ) : (
              <box flexDirection="row" flexGrow={1} gap={1}>
                <text fg={c.accent}>›</text>
                <box flexGrow={1}>
                  <textarea key={inputKey} placeholder={placeholder}
                    minHeight={1} maxHeight={6} width={"100%"} initialValue={initialValue}
                    keyBindings={[
                      { name: "return", action: "submit" },
                      { name: "return", shift: true, action: "newline" },
                    ]}
                    ref={(r: any) => { textareaRef.current = r }}
                    onSubmit={() => {
                      if (textareaRef.current) onSubmit(textareaRef.current.plainText)
                    }} focused={true} />
                </box>
              </box>
            )}
          </box>
          <box height={1} />
          <box flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
            <box flexDirection="row" gap={2} alignItems="center">
              <text fg={c.accent}>{agent}</text>
              <text fg={c.dim}>{model}</text>
              <text fg={c.subtext}>{provider}</text>
            </box>
            {tokenUsage && (
              <box flexDirection="row" gap={1} height={1}>
                {elapsedMs !== null && elapsedMs !== undefined && <text fg={c.dim}>{(elapsedMs / 1000).toFixed(1)}s</text>}
                <text fg={c.dim}>↑{tokenUsage.input} ↓{tokenUsage.output}</text>
              </box>
            )}
          </box>
        </box>
      </box>
    </box>
  )
}
