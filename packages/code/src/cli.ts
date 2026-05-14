#!/usr/bin/env node
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version") || args.includes("-v")) {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(`spectra-code v${pkg.default.version}`);
    process.exit(0);
  }

  if (args.includes("--help") || args.includes("-h") || args[0] === "help") {
    console.log(`
Spectra Code — AI coding agent in your terminal

Usage:
  spectra [command] [options]

Commands:
  spectra                    Launch the TUI
  spectra session list       List sessions
  spectra session delete <id>  Delete a session
  spectra agent list         List available agents
  spectra plugin list        List installed plugins
  spectra plugin install <name>  Install a plugin
  spectra db path            Show database path
  spectra doctor             Run system health check
  spectra help               Show this help

Options:
  -h, --help   Show help
  -v, --version Show version
`);
    process.exit(0);
  }

  const cmd = args[0];

  if (cmd === "session") {
    const { SessionStore } = await import("./services/session-store.js");
    const sub = args[1];
    if (sub === "list") {
      const sessions = new SessionStore().list();
      if (!sessions.length) { console.log("No sessions."); process.exit(0); }
      for (const s of sessions) console.log(`${s.id}  ${s.title.slice(0, 50)}  ${new Date(s.updated).toLocaleString()}`);
      process.exit(0);
    }
    if (sub === "delete" && args[2]) {
      process.exit(new SessionStore().delete(args[2]) ? 0 : (console.error("Not found"), 1));
    }
    console.error("Usage: spectra session <list|delete <id>>");
    process.exit(1);
  }

  if (cmd === "agent") {
    if (args[1] === "list") {
      console.log("build    Default agent (full tools)\nplan     Planning mode\nexplore  Codebase exploration\ndebug    Investigation");
      process.exit(0);
    }
    console.error("Usage: spectra agent <list>");
    process.exit(1);
  }

  if (cmd === "plugin" || cmd === "plug") {
    if (args[1] === "list") {
      console.log("No plugins installed.");
      process.exit(0);
    }
    if (args[1] === "install" && args[2]) {
      console.log(`Install "${args[2]}" — not yet implemented`);
      process.exit(0);
    }
    console.error("Usage: spectra plugin <list|install <name>>");
    process.exit(1);
  }

  if (cmd === "db") {
    if (args[1] === "path") {
      const { getGlobalDataDir } = await import("./utils/paths.js");
      console.log(`${getGlobalDataDir()}/spectra.db`);
      process.exit(0);
    }
    console.error("Usage: spectra db <path>");
    process.exit(1);
  }

  if (cmd === "doctor") {
    const { doctorCommand } = await import("./commands/doctor.js");
    await doctorCommand.handler({} as never);
    return;
  }

  // No (or unknown) command → launch TUI
  const { launchTui } = await import("./tui/index.js");
  await launchTui({});
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
