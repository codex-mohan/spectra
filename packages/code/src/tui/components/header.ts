import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";

export function createHeader(app: SpectraTuiApp): any {
  const { selectedAgent, selectedModel } = app.state;
  const provider = selectedModel.split("/")[0] || "anthropic";

  return Box(
    {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
      borderStyle: "single",
      borderColor: "#374151",
    },
    Box(
      {
        flexDirection: "row",
        gap: 2,
        alignItems: "center",
      },
      Text({ content: "Spectra", fg: "#7C3AED", attributes: 1 }),
      Text({ content: selectedAgent, fg: "#9CA3AF" }),
      Text({ content: selectedModel, fg: "#6B7280" }),
      Text({ content: provider, fg: "#4B5563" }),
    ),
    Box(
      {
        flexDirection: "row",
        gap: 1,
        alignItems: "center",
      },
      Text({ content: "0 MCP", fg: "#4B5563" }),
    ),
  );
}
