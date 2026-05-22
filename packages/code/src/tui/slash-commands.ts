export interface SlashHead {
  name: string
  arguments: string
  end: number
}

export interface ParsedSlashCommand {
  type: "command"
  command: { name: string; arguments: string }
}

export interface ParsedSlashNone {
  type: "none"
}

export type ParsedSlash = ParsedSlashCommand | ParsedSlashNone

export function slashHead(text: string): SlashHead | undefined {
  if (!text.startsWith("/")) return
  for (let i = 1; i < text.length; i++) {
    switch (text[i]) {
      case " ":
      case "\t":
      case "\n":
        return { name: text.slice(1, i), arguments: text.slice(i + 1), end: i }
    }
  }
  return { name: text.slice(1), arguments: "", end: text.length }
}

export function slashQuery(text: string, cursor: number): string | undefined {
  const head = slashHead(text.slice(0, cursor))
  if (!head || head.end !== cursor) return
  return head.name
}

export function parseSlashCommand(
  text: string,
  commands: Set<string> | undefined,
): ParsedSlash {
  const head = slashHead(text)
  if (!head || head.name.length === 0) return { type: "none" }
  if (!commands) return { type: "none" }
  if (!commands.has(head.name)) return { type: "none" }
  return { type: "command", command: { name: head.name, arguments: head.arguments } }
}
