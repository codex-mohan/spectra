import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema, ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, ListToolsResult, Tool as McpToolDefinition } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from '../../services/config.js';

export interface McpServerConfig {
	name: string;
	command?: string | string[];
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	enabled?: boolean;
	timeout?: number;
}

export interface ConnectedServer {
	name: string;
	client: Client;
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	tools: McpToolDefinition[];
	config: McpServerConfig;
}

const DEFAULT_TIMEOUT = 30000;

const connectedServers = new Map<string, ConnectedServer>();

export async function connectServer(config: McpServerConfig): Promise<ConnectedServer> {
	if (connectedServers.has(config.name)) {
		throw new Error(`Server "${config.name}" is already connected`);
	}

	const client = new Client({ name: `spectra-mcp-${config.name}`, version: '1.0.0' }, { capabilities: {} });

	const timeout = config.timeout ?? DEFAULT_TIMEOUT;
	let transport: StdioClientTransport | StreamableHTTPClientTransport;

	if (config.command && (Array.isArray(config.command) ? config.command.length > 0 : config.command.length > 0)) {
		const cmdArray = Array.isArray(config.command) ? config.command : config.command.split(' ').filter(Boolean);
		transport = new StdioClientTransport({
			command: cmdArray[0],
			args: cmdArray.slice(1),
			env: { ...process.env, ...config.env } as Record<string, string>,
		});
	} else if (config.url) {
		const url = new URL(config.url);
		transport = new StreamableHTTPClientTransport(url, {
			requestInit: {
				headers: config.headers ?? {},
			},
		});
	} else {
		throw new Error(`MCP server "${config.name}" must have either "command" or "url"`);
	}

	await client.connect(transport);

	let tools: McpToolDefinition[] = [];
	try {
		const result = await client.listTools();
		tools = result.tools ?? [];
	} catch {
		tools = [];
	}

	const connected: ConnectedServer = {
		name: config.name,
		client,
		transport,
		tools,
		config,
	};

	connectedServers.set(config.name, connected);

	client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
		try {
			const result = await client.listTools();
			const existing = connectedServers.get(config.name);
			if (existing) {
				existing.tools = result.tools ?? [];
			}
		} catch {
			// ignore
		}
	});

	return connected;
}

export async function disconnectServer(name: string): Promise<void> {
	const server = connectedServers.get(name);
	if (!server) {
		throw new Error(`Server "${name}" is not connected`);
	}

	try {
		await server.client.close();
	} catch {
		// ignore cleanup errors
	}

	connectedServers.delete(name);
}

export function getConnectedServer(name: string): ConnectedServer | undefined {
	return connectedServers.get(name);
}

export function listConnectedServers(): ConnectedServer[] {
	return Array.from(connectedServers.values());
}

export async function listServerTools(name: string): Promise<McpToolDefinition[]> {
	const server = connectedServers.get(name);
	if (!server) {
		throw new Error(`Server "${name}" is not connected`);
	}
	return server.tools;
}

export async function callMcpTool(
	serverName: string,
	toolName: string,
	args: Record<string, unknown>,
): Promise<CallToolResult> {
	const server = connectedServers.get(serverName);
	if (!server) {
		throw new Error(`Server "${serverName}" is not connected`);
	}

	const result = await server.client.callTool({
		name: toolName,
		arguments: args,
	});

	return result as CallToolResult;
}

export async function connectAllServers(configs: McpConfig[]): Promise<void> {
	const enabled = configs.filter((c) => c.enabled !== false);
	await Promise.all(
		enabled.map((cfg) =>
			connectServer(cfg).catch((err) => {
				console.error(`Failed to connect MCP server "${cfg.name}": ${err.message}`);
			}),
		),
	);
}

export async function shutdownAllServers(): Promise<void> {
	const names = Array.from(connectedServers.keys());
	await Promise.all(names.map((name) => disconnectServer(name).catch(() => {})));
}

export function sanitizeToolName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function formatMcpToolName(serverName: string, toolName: string): string {
	return `${sanitizeToolName(serverName)}_${sanitizeToolName(toolName)}`;
}
