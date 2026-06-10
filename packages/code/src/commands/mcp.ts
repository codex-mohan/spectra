import type { CommandModule } from 'yargs';
import { connectServer, disconnectServer, listConnectedServers, listServerTools } from '../integrations/mcp/index.js';
import { loadConfig, saveConfig, type SpectraConfig, type McpConfig } from '../services/config.js';

export const mcpListCommand: CommandModule = {
	command: 'mcp list',
	describe: 'List configured and connected MCP servers',
	handler: () => {
		const config = loadConfig();
		const servers = config.mcp ?? [];
		const connected = listConnectedServers().map((s) => s.name);

		if (servers.length === 0) {
			console.log('No MCP servers configured.');
			console.log('Use "spectra mcp add <name> <command>" to add one.');
			return;
		}

		console.log('Configured MCP servers:\n');
		for (const s of servers) {
			const isConnected = connected.includes(s.name);
			const status = s.enabled === false ? 'disabled' : isConnected ? 'connected' : 'disconnected';
			const target = s.command
				? `stdio: ${[s.command, ...(s.args ?? [])].join(' ')}`
				: s.url
					? `http: ${s.url}`
					: '(no target)';
			console.log(`  ${s.name} [${status}]`);
			console.log(`    ${target}`);
			if (isConnected) {
				const server = listConnectedServers().find((c) => c.name === s.name);
				const toolCount = server?.tools.length ?? 0;
				console.log(`    ${toolCount} tool(s) available`);
			}
			console.log();
		}
	},
};

export const mcpAddCommand: CommandModule = {
	command: 'mcp add <name> [command...]',
	describe: 'Add a local MCP server',
	builder: (yargs) =>
		yargs
			.option('url', {
				describe: 'Remote server URL (for HTTP/SSE transport)',
				type: 'string',
			})
			.option('env', {
				describe: 'Environment variables (KEY=VALUE, comma-separated)',
				type: 'string',
			})
			.option('header', {
				describe: 'HTTP headers (KEY=VALUE, comma-separated, for remote servers)',
				type: 'string',
			}),
	handler: (argv) => {
		const name = argv.name as string;
		const config = loadConfig();
		const servers = config.mcp ?? [];

		if (servers.find((s) => s.name === name)) {
			console.error(`Error: MCP server "${name}" already exists.`);
			process.exit(1);
		}

		const entry: McpConfig = { name };

		if (argv.url) {
			entry.url = argv.url as string;
			if (argv.header) {
				const headers: Record<string, string> = {};
				(argv.header as string).split(',').forEach((pair) => {
					const [key, ...rest] = pair.split('=');
					if (key && rest.length > 0) headers[key.trim()] = rest.join('=').trim();
				});
				entry.headers = headers;
			}
		} else if (argv.command && Array.isArray(argv.command) && argv.command.length > 0) {
			const cmds = argv.command as string[];
			entry.command = cmds[0];
			entry.args = cmds.slice(1);
		} else {
			console.error('Error: Provide either a command or --url for the server.');
			process.exit(1);
		}

		if (argv.env) {
			const env: Record<string, string> = {};
			(argv.env as string).split(',').forEach((pair) => {
				const [key, ...rest] = pair.split('=');
				if (key && rest.length > 0) env[key.trim()] = rest.join('=').trim();
			});
			entry.env = env;
		}

		entry.enabled = true;
		servers.push(entry);
		config.mcp = servers;
		saveConfig(config);
		console.log(`Added MCP server "${name}".`);
	},
};

export const mcpRemoveCommand: CommandModule = {
	command: 'mcp remove <name>',
	describe: 'Remove an MCP server configuration',
	handler: () => {
		const name = (mcpRemoveCommand as unknown as { argv?: { name: string } }).argv?.name;
		if (!name) {
			console.error('Usage: spectra mcp remove <name>');
			process.exit(1);
		}
		const config = loadConfig();
		const servers = config.mcp ?? [];
		const filtered = servers.filter((s) => s.name !== name);
		if (filtered.length === servers.length) {
			console.error(`Error: MCP server "${name}" not found.`);
			process.exit(1);
		}
		config.mcp = filtered;
		saveConfig(config);
		console.log(`Removed MCP server "${name}".`);
	},
};

export const mcpConnectCommand: CommandModule = {
	command: 'mcp connect <name>',
	describe: 'Connect to an MCP server',
	handler: async () => {
		const name = (mcpConnectCommand as unknown as { argv?: { name: string } }).argv?.name;
		if (!name) {
			console.error('Usage: spectra mcp connect <name>');
			process.exit(1);
		}
		const config = loadConfig();
		const server = (config.mcp ?? []).find((s) => s.name === name);
		if (!server) {
			console.error(`Error: MCP server "${name}" not found in config.`);
			process.exit(1);
		}

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
			console.log(`Connected to MCP server "${name}".`);
		} catch (err) {
			console.error(`Failed to connect: ${err instanceof Error ? err.message : String(err)}`);
			process.exit(1);
		}
	},
};

export const mcpDisconnectCommand: CommandModule = {
	command: 'mcp disconnect <name>',
	describe: 'Disconnect from an MCP server',
	handler: async () => {
		const name = (mcpDisconnectCommand as unknown as { argv?: { name: string } }).argv?.name;
		if (!name) {
			console.error('Usage: spectra mcp disconnect <name>');
			process.exit(1);
		}
		try {
			await disconnectServer(name);
			console.log(`Disconnected from MCP server "${name}".`);
		} catch (err) {
			console.error(`Failed to disconnect: ${err instanceof Error ? err.message : String(err)}`);
			process.exit(1);
		}
	},
};

export const mcpToolsCommand: CommandModule = {
	command: 'mcp tools <server>',
	describe: 'List tools from a connected MCP server',
	handler: async () => {
		const server = (mcpToolsCommand as unknown as { argv?: { server: string } }).argv?.server;
		if (!server) {
			console.error('Usage: spectra mcp tools <server>');
			process.exit(1);
		}

		try {
			const tools = await listServerTools(server);
			if (tools.length === 0) {
				console.log(`No tools available from server "${server}".`);
				return;
			}
			console.log(`Tools from "${server}":\n`);
			for (const tool of tools) {
				console.log(`  ${tool.name}`);
				if (tool.description) {
					console.log(`    ${tool.description}`);
				}
				console.log();
			}
		} catch (err) {
			console.error(`Failed to list tools: ${err instanceof Error ? err.message : String(err)}`);
			process.exit(1);
		}
	},
};

export const mcpCommands: CommandModule[] = [
	mcpListCommand,
	mcpAddCommand,
	mcpRemoveCommand,
	mcpConnectCommand,
	mcpDisconnectCommand,
	mcpToolsCommand,
];
