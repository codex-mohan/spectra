export type ContentBlock =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "toolCall"; name: string; args: string }

export interface ChatMessage {
  id: string
  role: "user" | "assistant" | "tool" | "error"
  content: string
  blocks?: ContentBlock[]
  meta?: string
  streaming?: boolean
  model?: string
}
