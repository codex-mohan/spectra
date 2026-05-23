#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { spinner, text, confirm, select, intro, outro, isCancel, cancel } from "@clack/prompts";
import chalk from "chalk";
import { SessionStore } from "./services/session-store.js";
import { loadConfig, saveConfig } from "./services/config.js";
import { connectServer, disconnectServer, listConnectedServers, listServerTools } from "./services/mcp.js";

async function main() {
  const pkg = await import("../package.json", { with: { type: "json" } });
  const version = pkg.default.version;

  const cli = yargs(hideBin(process.argv))
    .scriptName("spectra")
    .version(version)
    .help()
    .alias("h", "help")
    .alias("v", "version")
    .locale("en")
    .wrap(Math.min(100, process.stdout.columns || 100))
    .epilogue(chalk.dim("Spectra Code — AI coding agent in your terminal"));

  // Default: launch TUI
  cli.command(
    "$0",
    false,
    () => {},
    async () => {
      const { launchTui } = await import("./tui/index.js");
      await launchTui({});
    }
  );

  // Session commands
  cli.command(
    "session <action>",
    "Manage sessions",
    (y) =>
      y
        .positional("action", {
          describe: "Action to perform",
          choices: ["list", "delete"],
          demandOption: true,
        })
        .option("id", {
          describe: "Session ID (for delete)",
          type: "string",
        }),
    async (argv) => {
      const store = new SessionStore();
      const action = argv.action as string;

      if (action === "list") {
        const sessions = store.list();
        if (!sessions.length) {
          outro(chalk.yellow("No sessions found."));
          return;
        }
        console.log(chalk.bold("\n  Sessions\n"));
        for (const s of sessions) {
          const date = new Date(s.updated).toLocaleString();
          console.log(`  ${chalk.cyan(s.id.slice(0, 12))}  ${chalk.white(s.title.slice(0, 50))}  ${chalk.dim(date)}`);
        }
        console.log();
        outro(chalk.dim(`${sessions.length} session(s)`));
        return;
      }

      if (action === "delete") {
        const id = argv.id;
        if (!id) {
          const selected = await select({
            message: "Select session to delete",
            options: store.list().map((s) => ({
              value: s.id,
              label: `${s.id.slice(0, 12)}  ${s.title.slice(0, 50)}`,
            })),
          });
          if (isCancel(selected)) { cancel("Cancelled."); process.exit(0); }
          const ok = await confirm({ message: "Are you sure?" });
          if (!ok) { cancel("Cancelled."); process.exit(0); }
          store.delete(selected as string);
          outro(chalk.green(`Deleted session ${selected}`));
        } else {
          const ok = store.delete(id);
          if (ok) outro(chalk.green(`Deleted session ${id}`));
          else { outro(chalk.red(`Session "${id}" not found.`)); process.exit(1); }
        }
        return;
      }
    }
  );

  // Agent commands
  cli.command(
    "agent <action>",
    "Manage agents",
    (y) =>
      y.positional("action", {
        describe: "Action to perform",
        choices: ["list"],
        demandOption: true,
      }),
    async (argv) => {
      if (argv.action === "list") {
        const agents = [
          { name: "build", desc: "Default agent (full tools)" },
          { name: "plan", desc: "Planning mode" },
          { name: "explore", desc: "Codebase exploration" },
          { name: "debug", desc: "Investigation" },
        ];
        console.log(chalk.bold("\n  Agents\n"));
        for (const a of agents) {
          console.log(`  ${chalk.cyan(a.name.padEnd(10))}  ${chalk.dim(a.desc)}`);
        }
        console.log();
        outro(`${agents.length} agent(s)`);
      }
    }
  );

  // Plugin commands
  cli.command(
    "plugin <action>",
    "Manage plugins",
    (y) =>
      y
        .positional("action", {
          describe: "Action to perform",
          choices: ["list", "install"],
          demandOption: true,
        })
        .option("name", {
          describe: "Plugin name (for install)",
          type: "string",
        }),
    async (argv) => {
      if (argv.action === "list") {
        outro(chalk.yellow("No plugins installed."));
        return;
      }
      if (argv.action === "install") {
        const name = argv.name;
        if (!name) {
          const input = await text({ message: "Plugin name to install" });
          if (isCancel(input)) { cancel("Cancelled."); process.exit(0); }
          outro(chalk.yellow(`Install "${input}" — not yet implemented`));
        } else {
          outro(chalk.yellow(`Install "${name}" — not yet implemented`));
        }
      }
    }
  );

  // MCP commands
  cli.command(
    "mcp <action>",
    "Manage MCP servers",
    (y) =>
      y
        .positional("action", {
          describe: "Action to perform",
          choices: ["list", "add", "remove", "connect", "disconnect", "tools"],
          demandOption: true,
        })
        .option("name", { describe: "Server name", type: "string" })
        .option("url", { describe: "Remote server URL", type: "string" })
        .option("env", { describe: "Environment variables (KEY=VALUE, comma-separated)", type: "string" })
        .option("header", { describe: "HTTP headers (KEY=VALUE, comma-separated)", type: "string" })
        .option("command", { describe: "Command to run (for local servers)", type: "string" })
        .option("server", { describe: "Server name (for tools command)", type: "string" }),
    async (argv) => {
      const action = argv.action as string;
      const config = loadConfig();

      if (action === "list") {
        const servers = config.mcp ?? [];
        const connected = listConnectedServers().map((s) => s.name);

        if (!servers.length) {
          outro(chalk.yellow("No MCP servers configured."));
          console.log(chalk.dim(`  Use "spectra mcp add <name> --command ..." to add one.\n`));
          return;
        }

        console.log(chalk.bold("\n  MCP Servers\n"));
        for (const s of servers) {
          const isConnected = connected.includes(s.name);
          const statusColor = s.enabled === false ? chalk.red : isConnected ? chalk.green : chalk.yellow;
          const status = s.enabled === false ? "disabled" : isConnected ? "connected" : "disconnected";
          const target = s.command
            ? `stdio: ${chalk.dim([s.command, ...(s.args ?? [])].join(" "))}`
            : s.url
              ? `http: ${chalk.dim(s.url)}`
              : chalk.dim("(no target)");

          console.log(`  ${chalk.cyan(s.name)}  ${statusColor(`[${status}]`)}`);
          console.log(`    ${target}`);
          if (isConnected) {
            const server = listConnectedServers().find((c) => c.name === s.name);
            const count = server?.tools.length ?? 0;
            console.log(`    ${chalk.dim(`${count} tool(s) available`)}`);
          }
          console.log();
        }
        outro(`${servers.length} server(s) configured`);
        return;
      }

      if (action === "add") {
        let serverName = argv.name as string | undefined;
        if (!serverName) {
          const input = await text({ message: "Server name" });
          if (isCancel(input)) { cancel("Cancelled."); process.exit(0); }
          serverName = input as string;
        }
        const servers = config.mcp ?? [];
        if (servers.find((s) => s.name === serverName)) {
          outro(chalk.red(`Server "${serverName}" already exists.`));
          process.exit(1);
        }

        let command = argv.command as string | undefined;
        let url = argv.url as string | undefined;

        if (!command && !url) {
          const choice = await select({
            message: "Server type",
            options: [
              { value: "local", label: "Local (stdio)" },
              { value: "remote", label: "Remote (HTTP)" },
            ],
          });
          if (isCancel(choice)) { cancel("Cancelled."); process.exit(0); }

          if (choice === "local") {
            const cmdInput = await text({ message: "Command (e.g. npx -y @modelcontextprotocol/server-filesystem /path)" });
            if (isCancel(cmdInput)) { cancel("Cancelled."); process.exit(0); }
            command = cmdInput as string;
          } else {
            const urlInput = await text({ message: "Server URL" });
            if (isCancel(urlInput)) { cancel("Cancelled."); process.exit(0); }
            url = urlInput as string;
          }
        }

        const entry: any = { name: serverName };
        if (url) {
          entry.url = url;
          if (argv.header) {
            const headers: Record<string, string> = {};
            (argv.header as string).split(",").forEach((pair) => {
              const [key, ...rest] = pair.split("=");
              if (key && rest.length > 0) headers[key.trim()] = rest.join("=").trim();
            });
            entry.headers = headers;
          }
        } else if (command) {
          const parts = command.split(" ");
          entry.command = parts[0];
          entry.args = parts.slice(1);
        }

        if (argv.env) {
          const env: Record<string, string> = {};
          (argv.env as string).split(",").forEach((pair) => {
            const [key, ...rest] = pair.split("=");
            if (key && rest.length > 0) env[key.trim()] = rest.join("=").trim();
          });
          entry.env = env;
        }

        entry.enabled = true;
        servers.push(entry);
        config.mcp = servers;
        saveConfig(config);
        outro(chalk.green(`Added MCP server "${serverName}".`));
        return;
      }

      if (action === "remove") {
        const name = argv.name;
        if (!name) {
          const input = await text({ message: "Server name to remove" });
          if (isCancel(input)) { cancel("Cancelled."); process.exit(0); }
          argv.name = input as string;
        }
        const serverName = argv.name as string;
        const servers = config.mcp ?? [];
        const filtered = servers.filter((s) => s.name !== serverName);
        if (filtered.length === servers.length) {
          outro(chalk.red(`Server "${serverName}" not found.`));
          process.exit(1);
        }
        config.mcp = filtered;
        saveConfig(config);
        outro(chalk.green(`Removed MCP server "${serverName}".`));
        return;
      }

      if (action === "connect") {
        let serverName = argv.name as string | undefined;
        if (!serverName) {
          const servers = (config.mcp ?? []).filter((s) => s.enabled !== false);
          if (!servers.length) {
            outro(chalk.yellow("No servers to connect."));
            return;
          }
          const selected = await select({
            message: "Select server to connect",
            options: servers.map((s) => ({
              value: s.name,
              label: `${s.name} (${s.command ? "stdio" : "http"})`,
            })),
          });
          if (isCancel(selected)) { cancel("Cancelled."); process.exit(0); }
          serverName = selected as string;
        }
        const server = (config.mcp ?? []).find((s) => s.name === serverName);
        if (!server) {
          outro(chalk.red(`Server "${serverName}" not found.`));
          process.exit(1);
        }

        const s = spinner();
        s.start(`Connecting to "${serverName}"...`);
        try {
          await connectServer({
            name: server.name,
            command: server.command ? [server.command, ...(server.args ?? [])] : undefined,
            env: server.env,
            url: server.url,
            headers: server.headers,
            enabled: server.enabled,
            timeout: server.timeout,
          });
          const tools = await listServerTools(serverName);
          s.stop(chalk.green(`Connected to "${serverName}" (${tools.length} tools)`));
        } catch (err) {
          s.stop(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
        return;
      }

      if (action === "disconnect") {
        let serverName = argv.name as string | undefined;
        if (!serverName) {
          const connected = listConnectedServers();
          if (!connected.length) {
            outro(chalk.yellow("No servers connected."));
            return;
          }
          const selected = await select({
            message: "Select server to disconnect",
            options: connected.map((s) => ({ value: s.name, label: s.name })),
          });
          if (isCancel(selected)) { cancel("Cancelled."); process.exit(0); }
          serverName = selected as string;
        }
        try {
          await disconnectServer(serverName);
          outro(chalk.green(`Disconnected from "${serverName}".`));
        } catch (err) {
          outro(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
        return;
      }

      if (action === "tools") {
        let serverName = (argv.server || argv.name) as string | undefined;
        if (!serverName) {
          const connected = listConnectedServers();
          if (!connected.length) {
            outro(chalk.yellow("No servers connected."));
            return;
          }
          const selected = await select({
            message: "Select server",
            options: connected.map((s) => ({ value: s.name, label: `${s.name} (${s.tools.length} tools)` })),
          });
          if (isCancel(selected)) { cancel("Cancelled."); process.exit(0); }
          serverName = selected as string;
        }
        try {
          const tools = await listServerTools(serverName);
          if (!tools.length) {
            outro(chalk.yellow(`No tools from "${serverName}".`));
            return;
          }
          console.log(chalk.bold(`\n  Tools from "${serverName}"\n`));
          for (const t of tools) {
            console.log(`  ${chalk.cyan(t.name)}`);
            if (t.description) console.log(`    ${chalk.dim(t.description)}`);
            console.log();
          }
          outro(`${tools.length} tool(s)`);
        } catch (err) {
          outro(chalk.red(`Failed: ${err instanceof Error ? err.message : String(err)}`));
          process.exit(1);
        }
        return;
      }
    }
  );

  // Doctor command
  cli.command(
    "doctor",
    "Run system health check",
    () => {},
    async () => {
      const { runDoctor } = await import("./commands/doctor.js");
      const result = await runDoctor();
      process.stdout.write("Spectra Code — System Health Check\n\n");
      for (const check of result.checks) {
        process.stdout.write(`${check.passed ? "✓" : "✗"} [${check.section}] ${check.name}\n`);
        process.stdout.write(`  ${check.detail}\n`);
      }
      process.stdout.write(`\n${result.allPassed ? "✓ All checks passed." : "✗ Some checks failed — review the items above."}\n`);
      process.exit(result.allPassed ? 0 : 1);
    }
  );

  // DB command
  cli.command(
    "db <action>",
    "Database utilities",
    (y) =>
      y.positional("action", {
        describe: "Action",
        choices: ["path"],
        demandOption: true,
      }),
    async (argv) => {
      if (argv.action === "path") {
        const { getGlobalDataDir } = await import("./utils/paths.js");
        console.log(`${getGlobalDataDir()}/spectra.db`);
      }
    }
  );

  await cli.parse();
}

main().catch((err) => {
  console.error(chalk.red("Fatal:"), err);
  process.exit(1);
});
