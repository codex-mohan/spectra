import { useRef, useEffect } from "react"
import { c, SPINNER } from "./theme.js"
import { titlecase } from "./utils.js"

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
  thinkingEffort?: string
  initialValue?: string
  width?: number | "auto"
  elapsedMs?: number | null
  tokenUsage?: { input: number; output: number }
  focused?: boolean
  onTextChange?: (text: string) => void
  onGetTextarea?: (ref: any) => void
  onPositionChange?: (pos: { top: number; left: number; width: number }) => void
}

export function PromptBar(props: PromptBarProps) {
  const { isLoading, spinnerFrame, inputKey, placeholder, onSubmit, hasModel, agent, model, provider, thinkingEffort, initialValue, width, elapsedMs, tokenUsage, focused = true, onTextChange, onGetTextarea, onPositionChange } = props
  const textareaRef = useRef<any>(null)
  const boxRef = useRef<any>(null)

  useEffect(() => {
    if (onPositionChange && boxRef.current) {
      const updatePosition = () => {
        const el = boxRef.current
        if (el) {
          onPositionChange({
            top: el.y ?? 0,
            left: el.x ?? 0,
            width: el.width ?? 0
          })
        }
      }
      updatePosition()
      const interval = setInterval(updatePosition, 100)
      return () => clearInterval(interval)
    }
  }, [onPositionChange])

  if (!hasModel && !isLoading) {
    return (
      <box flexDirection="row">
        <box width={1} backgroundColor={c.accent} height={"auto"} />
        <box flexDirection="row" alignItems="center" backgroundColor={c.bgBar}
          paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}
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
    <box flexDirection="column" ref={boxRef}>
      <box flexDirection="row">
        <box width={1} backgroundColor={c.accent} height={"auto"} />
        <box flexDirection="row" alignItems="center" backgroundColor={c.bgBar}
          paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1}
          width={width ?? "auto"}>
          <box flexDirection="column" flexGrow={1} paddingLeft={2}>
            <box minHeight={1} maxHeight={6}>
              <box flexDirection="row" flexGrow={1} gap={1}>
                {isLoading ? (
                  <text fg={c.warn}>{SPINNER[spinnerFrame]}</text>
                ) : (
                  <text fg={c.accent}>›</text>
                )}
                <box flexGrow={1}>
                  <textarea key={inputKey} placeholder={isLoading ? "Streaming..." : placeholder}
                    minHeight={1} maxHeight={6} width={"100%"} initialValue={initialValue}
                    keyBindings={[
                      { name: "return", action: "submit" },
                      { name: "return", shift: true, action: "newline" },
                    ]}
                    ref={(r: any) => { textareaRef.current = r; onGetTextarea?.(r) }}
                    onContentChange={() => {
                      if (textareaRef.current && onTextChange) {
                        onTextChange(textareaRef.current.plainText)
                      }
                    }}
                    onSubmit={() => {
                      if (textareaRef.current) onSubmit(textareaRef.current.plainText)
                    }} focused={focused} />
                </box>
              </box>
            </box>
            <box height={1} />
            <box flexDirection="row" justifyContent="space-between" alignItems="center" height={1}>
              <box flexDirection="row" gap={2} alignItems="center">
                <text fg={c.accent}>{titlecase(agent)}</text>
                <text fg={c.dim}>{model}</text>
                <text fg={c.subtext}>{provider}</text>
                {thinkingEffort && thinkingEffort !== "none" && (
                  <text fg={c.warn}>{thinkingEffort}</text>
                )}
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
    </box>
  )
}
