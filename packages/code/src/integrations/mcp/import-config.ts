import type { McpConfig } from '../../services/config.js';

export type McpImportOutcome =
	| { ok: false; error: string }
	| { ok: true; servers: McpConfig[]; skipped: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accepts plain JSON plus the comment and trailing-comma leniency used by config files. */
function parseJsonLoose(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		const stripped = text
			.replace(/\/\*[\s\S]*?\*\//g, '')
			.replace(/(?<![:"])\/\/[^\n\r]*/g, '')
			.replace(/,(\s*[}\]])/g, '$1');
		return JSON.parse(stripped);
	}
}

function toStringRecord(value: Record<string, unknown>): Record<string, string> | undefined {
	const record: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (entry === null || entry === undefined) continue;
		record[key] = String(entry);
	}
	return Object.keys(record).length > 0 ? record : undefined;
}

function looksLikeServer(value: unknown): value is Record<string, unknown> {
	if (!isRecord(value)) return false;
	return typeof value.command === 'string' || Array.isArray(value.command) || typeof value.url === 'string';
}

function serverEntries(root: Record<string, unknown>): Array<[string, Record<string, unknown>]> | undefined {
	const nested = root.mcpServers ?? root.servers;
	if (isRecord(nested)) {
		return Object.entries(nested).filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]));
	}
	if (Array.isArray(nested)) {
		return nested
			.filter(isRecord)
			.map((entry, index): [string, Record<string, unknown>] => [
				typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `server-${index + 1}`,
				entry,
			]);
	}
	if (Object.values(root).some(looksLikeServer)) {
		return Object.entries(root).filter((entry): entry is [string, Record<string, unknown>] => looksLikeServer(entry[1]));
	}
	return undefined;
}

function toMcpConfig(name: string, value: Record<string, unknown>): McpConfig | undefined {
	const server: McpConfig = { name };

	const command = value.command;
	if (Array.isArray(command) && command.length > 0) {
		server.command = String(command[0]);
		const rest = command.slice(1).map((part) => String(part));
		if (rest.length > 0) server.args = rest;
	} else if (typeof command === 'string' && command.trim()) {
		server.command = command.trim();
	}

	if (Array.isArray(value.args)) {
		const args = value.args.map((part) => String(part));
		if (args.length > 0) server.args = args;
	}
	if (typeof value.url === 'string' && value.url.trim()) server.url = value.url.trim();
	if (isRecord(value.env)) server.env = toStringRecord(value.env);
	if (isRecord(value.headers)) server.headers = toStringRecord(value.headers);
	if (typeof value.timeout === 'number' && Number.isFinite(value.timeout) && value.timeout > 0) server.timeout = value.timeout;

	server.enabled = typeof value.enabled === 'boolean'
		? value.enabled
		: typeof value.disabled === 'boolean' ? !value.disabled : true;

	if (!server.command && !server.url) return undefined;
	return server;
}

/** Names are slugged so imported keys such as `my.server` stay addressable. */
export function sanitizeServerName(name: string): string {
	const slug = name.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
	return slug || 'server';
}

/**
 * Parses a `mcpServers` block (`.mcp.json`, `claude_desktop_config.json`), a
 * bare `{ name: { command } }` map, or an array of named entries.
 */
export function parseMcpServersJson(raw: string): McpImportOutcome {
	const text = raw.trim();
	if (!text) return { ok: false, error: 'Nothing to import' };

	let parsed: unknown;
	try {
		parsed = parseJsonLoose(text);
	} catch (err) {
		return { ok: false, error: `Invalid JSON: ${err instanceof Error ? err.message : String(err)}` };
	}
	if (!isRecord(parsed)) return { ok: false, error: 'Expected a JSON object' };

	const entries = serverEntries(parsed);
	if (!entries || entries.length === 0) {
		return { ok: false, error: 'No servers found — expected an "mcpServers" block or a map of server configs' };
	}

	const byName = new Map<string, McpConfig>();
	const skipped: string[] = [];
	for (const [key, value] of entries) {
		const name = sanitizeServerName(typeof value.name === 'string' && value.name.trim() ? value.name : key);
		const server = toMcpConfig(name, value);
		if (server) byName.set(name, server);
		else skipped.push(name);
	}

	const servers = [...byName.values()];
	if (servers.length === 0) {
		return { ok: false, error: 'No usable servers found — each entry needs a "command" or "url"' };
	}
	return { ok: true, servers, skipped };
}
