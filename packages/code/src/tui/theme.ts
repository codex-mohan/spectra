import { RGBA, SyntaxStyle } from "@opentui/core"

// Catppuccin Mocha palette — purple-forward like opencode
export const c = {
  text: "#CDD6F4",
  subtext: "#BAC2DE",
  dim: "#6C7086",
  accent: "#CBA6F7",
  purple: "#B4BEFE",
  success: "#A6E3A1",
  warn: "#F9E2AF",
  error: "#F38BA8",
  user: "#89B4FA",
  tool: "#FAB387",
  thinking: "#B4BEFE",
  info: "#74C7EC",

  bg: "#1E1E2E",
  bgBar: "#181825",
  bgCard: "#252536",
  bgThink: "#232438",
  bgTool: "#272535",
  bgInput: "#1A1A2E",
  bgOverlay: "#11111BBB",

  sbThumb: "#45475A",
  sbTrack: "#313244",
  border: "#313244",
}

export const mdStyle = SyntaxStyle.fromStyles({
  "markup.heading.1": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex(c.accent), bold: true },
  "markup.heading.4": { fg: RGBA.fromHex(c.accent) },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.list": { fg: RGBA.fromHex(c.text) },
  "markup.raw": { fg: RGBA.fromHex(c.thinking) },
  "markup.link": { fg: RGBA.fromHex(c.user) },
  "markup.quote": { fg: RGBA.fromHex(c.dim) },
  "markup.table": { fg: RGBA.fromHex(c.text) },
  "markup.table.header": { fg: RGBA.fromHex(c.accent), bold: true },
  keyword: { fg: RGBA.fromHex(c.accent) },
  string: { fg: RGBA.fromHex(c.success) },
  comment: { fg: RGBA.fromHex(c.dim), italic: true },
  number: { fg: RGBA.fromHex(c.tool) },
  function: { fg: RGBA.fromHex(c.user) },
  type: { fg: RGBA.fromHex(c.accent) },
  default: { fg: RGBA.fromHex(c.text) },
})

export const SPINNER = [
  "\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826",
  "\u2827", "\u2807", "\u280F",
]
