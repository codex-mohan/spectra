import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
	CallToolResultSchema,
	ResourceListChangedNotificationSchema,
	ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, ListToolsResult, Tool as McpToolDefinition } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from '../../services/config.js';

export interface McpResourceDefinition {
	uri: string;
	name?: string;
	description?: string;
	mimeType?: string;
}

export interface McpResourceTemplateDefinition {
	uriTemplate: string;
	name?: string;
	description?: string;
	mimeType?: string;
}

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
	resources: McpResourceDefinition[];
	resourceTemplates: McpResourceTemplateDefinition[];
	config: McpServerConfig;
	refCount: number;
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

	let resources: McpResourceDefinition[] = [];
	let resourceTemplates: McpResourceTemplateDefinition[] = [];
	try {
		const result = await client.listResources();
		resources = (result.resources ?? []) as McpResourceDefinition[];
	} catch {
		resources = [];
	}
	try {
		const result = await client.listResourceTemplates();
		resourceTemplates = (result.resourceTemplates ?? []) as McpResourceTemplateDefinition[];
	} catch {
		resourceTemplates = [];
	}

	const connected: ConnectedServer = {
		name: config.name,
		client,
		transport,
		tools,
		resources,
		resourceTemplates,
		config,
		refCount: 0,
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

	client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
		const existing = connectedServers.get(config.name);
		if (!existing) return;
		try {
			const result = await client.listResources();
			existing.resources = (result.resources ?? []) as McpResourceDefinition[];
		} catch {
			// Keep the last known resource list when refresh fails.
		}
		try {
			const result = await client.listResourceTemplates();
			existing.resourceTemplates = (result.resourceTemplates ?? []) as McpResourceTemplateDefinition[];
		} catch {
			// Keep the last known template list when refresh fails.
		}
	});

	return connected;
}

export async function disconnectServer(name: string, force = false): Promise<void> {
	const server = connectedServers.get(name);
	if (!server) {
		throw new Error(`Server "${name}" is not connected`);
	}

	if (server.refCount > 0 && !force) {
		return;
	}

	try {
		await server.client.close();
	} catch {
		// ignore cleanup errors
	}

	connectedServers.delete(name);
}

export function acquireServer(name: string): void {
	const server = connectedServers.get(name);
	if (server) {
		server.refCount++;
	}
}

export function releaseServer(name: string): void {
	const server = connectedServers.get(name);
	if (server && server.refCount > 0) {
		server.refCount--;
	}
}

export function getServerRefCount(name: string): number {
	return connectedServers.get(name)?.refCount ?? 0;
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

export async function readServerResource(serverName: string, uri: string) {
	const server = connectedServers.get(serverName);
	if (!server) throw new Error(`Server "${serverName}" is not connected`);
	return server.client.readResource({ uri });
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
	await Promise.all(names.map((name) => disconnectServer(name, true).catch(() => {})));
}

export function sanitizeToolName(name: string): string {
	return name.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function formatMcpToolName(serverName: string, toolName: string): string {
	return `${sanitizeToolName(serverName)}_${sanitizeToolName(toolName)}`;
}
