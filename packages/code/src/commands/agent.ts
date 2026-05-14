import type { CommandModule } from "yargs";

export const agentCommand: CommandModule = {
  command: "agent",
  describe: "Manage agents",
  builder: (yargs) => yargs
    .command({
      command: "list",
      describe: "List available agents",
      handler: () => {
        console.log("Available agents:");
        console.log("  build     Default agent with full tool access");
        console.log("  plan      Planning mode with limited tools");
        console.log("  explore   Fast codebase exploration");
        console.log("  general   Multi-step task execution");
        console.log("  debug     Debugging and investigation");
      },
    })
    .command({
      command: "create <name>",
      describe: "Create a new agent (opens editor)",
      handler: (argv: Record<string, unknown>) => {
        console.log(`Creating agent "${argv.name}"...`);
        console.log("(Feature not yet implemented - will open agent config editor)");
      },
    })
    .demandCommand(1, "Please specify a subcommand"),
  handler: () => { },
};
