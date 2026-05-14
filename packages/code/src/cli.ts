#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { sessionCommand } from "./commands/session.js";
import { agentCommand } from "./commands/agent.js";
import { pluginCommand } from "./commands/plugin.js";
import { dbCommand } from "./commands/db.js";
import { doctorCommand } from "./commands/doctor.js";

async function main() {
  const cli = yargs(hideBin(process.argv))
    .scriptName("spectra")
    .version(false)
    .option("version", {
      alias: "v",
      type: "boolean",
      describe: "Show version number",
    })
    .option("help", {
      alias: "h",
      type: "boolean",
      describe: "Show help",
    })
    .command(
      "$0",
      "Launch the Spectra Code TUI",
      () => {},
      async (argv) => {
        if (argv.help) {
          yargs(hideBin(process.argv)).showHelp();
          return;
        }
        if (argv.version) {
          const pkg = await import("../package.json", { with: { type: "json" } });
          console.log(`spectra-code v${pkg.default.version}`);
          return;
        }
        const { launchTui } = await import("./tui/index.js");
        await launchTui({});
      },
    )
    .command(sessionCommand)
    .command(agentCommand)
    .command(pluginCommand)
    .command(dbCommand)
    .command(doctorCommand)
    .command({
      command: "help",
      describe: "Show help information",
      handler: () => {
        yargs(hideBin(process.argv)).showHelp();
      },
    })
    .strict()
    .demandCommand(0, "");

  const parsed = await cli.parseAsync();

  if ((parsed as Record<string, unknown>).version) {
    const pkg = await import("../package.json", { with: { type: "json" } });
    console.log(`spectra-code v${pkg.default.version}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
