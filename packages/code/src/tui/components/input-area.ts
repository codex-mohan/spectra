import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";

export function createInputArea(app: SpectraTuiApp): any {
  const { selectedAgent, selectedModel, inputValue } = app.state;
  const providerName = selectedModel.split("/")[0] || "anthropic";
  const mcpCount = 0;

  const hasProviders = true;

  return Box(
    {
      flexDirection: "column",
      padding: 1,
      borderStyle: "rounded",
      borderColor: "#4B5563",
    },

    Box(
      {
        flexDirection: "row",
        alignItems: "center",
      },
      Text({ content: "> ", fg: "#10B981" }),
      Text({
        content: inputValue || "Enter your message...",
        fg: inputValue ? "#FFFFFF" : "#6B7280",
      }),
    ),

    Box(
      {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: 1,
      },
      Box(
        {
          flexDirection: "row",
          gap: 2,
        },
        Box(
          {
            borderStyle: "single",
            borderColor: "#7C3AED",
            paddingLeft: 1,
            paddingRight: 1,
          },
          Text({ content: selectedAgent, fg: "#7C3AED" }),
        ),
        Text({ content: selectedModel, fg: "#9CA3AF" }),
        Text({ content: providerName, fg: "#6B7280" }),
      ),
      Box(
        {
          flexDirection: "row",
          gap: 1,
        },
        Text({ content: `${mcpCount} MCP`, fg: "#6B7280" }),
      ),
    ),
  );
}
