import { Box, Text } from "@opentui/core";
import type { SpectraTuiApp } from "../app.js";

export interface PaletteItem {
  id: string;
  label: string;
  description: string;
  category: string;
  action: () => void;
}

export function getPaletteItems(app: SpectraTuiApp): PaletteItem[] {
  return [
    {
      id: "session-new",
      label: "New Session",
      description: "Start a new chat session",
      category: "Session",
      action: () => {
        app.state.messages = [];
        app.state.session = null;
        app.state.paletteOpen = false;
        app.state.route = "chat";
        app.update();
      },
    },
    {
      id: "session-list",
      label: "Session List",
      description: "Browse and switch sessions",
      category: "Session",
      action: () => {
        app.state.paletteOpen = false;
        app.update();
        const sessions = app.sessionStore.list();
        console.log("\nSessions:");
        for (const s of sessions) {
          console.log(`  ${s.id}  ${s.title}`);
        }
      },
    },
    {
      id: "home",
      label: "Go Home",
      description: "Return to the home screen",
      category: "Navigation",
      action: () => {
        app.state.paletteOpen = false;
        app.navigate("home");
      },
    },
    {
      id: "agent-build",
      label: "Agent: Build",
      description: "Switch to build agent (full tool access)",
      category: "Agent",
      action: () => {
        app.state.selectedAgent = "build";
        app.state.paletteOpen = false;
        app.update();
      },
    },
    {
      id: "agent-plan",
      label: "Agent: Plan",
      description: "Switch to planning mode",
      category: "Agent",
      action: () => {
        app.state.selectedAgent = "plan";
        app.state.paletteOpen = false;
        app.update();
      },
    },
    {
      id: "agent-debug",
      label: "Agent: Debug",
      description: "Switch to debugging mode",
      category: "Agent",
      action: () => {
        app.state.selectedAgent = "debug";
        app.state.paletteOpen = false;
        app.update();
      },
    },
    {
      id: "theme-toggle",
      label: "Toggle Theme",
      description: "Switch between dark and light themes",
      category: "Settings",
      action: () => {
        app.state.paletteOpen = false;
        app.update();
      },
    },
    {
      id: "doctor",
      label: "Run Doctor",
      description: "Run system health check",
      category: "System",
      action: () => {
        app.state.paletteOpen = false;
        app.renderer.destroy();
        const { doctorCommand } = require("../../commands/doctor.js");
        doctorCommand.handler({} as Record<string, unknown>);
      },
    },
    {
      id: "help",
      label: "Help",
      description: "Show keyboard shortcuts and usage",
      category: "System",
      action: () => {
        app.state.paletteOpen = false;
        app.renderer.destroy();
        console.log(`
Spectra Code - Keyboard Shortcuts
  Ctrl+P     Command palette
  Ctrl+C     Exit
  Escape     Back to home
  Enter      Send message
  Up/Down    Navigate history
`);
      },
    },
    {
      id: "exit",
      label: "Exit",
      description: "Quit Spectra Code",
      category: "System",
      action: () => {
        app.renderer.destroy();
        process.exit(0);
      },
    },
  ];
}

export function createCommandPalette(app: SpectraTuiApp): any {
  const items = getPaletteItems(app);

  return Box(
    {
      position: "absolute",
      left: "10%",
      top: "20%",
      width: "80%",
      height: "60%",
      borderStyle: "rounded",
      borderColor: "#7C3AED",
      backgroundColor: "#1A1B23",
      padding: 1,
      flexDirection: "column",
    },

    Box(
      {
        paddingBottom: 1,
      },
      Text({ content: "  Commands", fg: "#7C3AED", attributes: 1 }),
    ),

    Box(
      {
        flexDirection: "column",
        gap: 0,
        flexGrow: 1,
      },
      ...items.map((item) =>
        Box(
          {
            flexDirection: "row",
            paddingLeft: 1,
            paddingRight: 1,
            gap: 2,
          },
          Text({ content: item.category, fg: "#6B7280" }),
          Text({ content: item.label, fg: "#FFFFFF" }),
          Text({ content: item.description, fg: "#4B5563" }),
        ),
      ),
    ),

    Text({
      content: "  Ctrl+P to close · ↑↓ to navigate · Enter to select",
      fg: "#4B5563",
    }),
  );
}
