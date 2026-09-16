import { describe, expect, it } from 'vitest';
import { formatArguments, splitArguments } from '../integrations/mcp/args.js';
import { parseMcpServersJson, sanitizeServerName } from '../integrations/mcp/import-config.js';
import { MCP_PRESETS } from '../integrations/mcp/presets.js';

describe('splitArguments', () => {
	it('splits on whitespace and collapses runs', () => {
		expect(splitArguments('-y  @scope/server   /tmp')).toEqual(['-y', '@scope/server', '/tmp']);
	});

	it('keeps quoted paths intact', () => {
		expect(splitArguments('-y server "C:/Program Files/app"')).toEqual(['-y', 'server', 'C:/Program Files/app']);
		expect(splitArguments("-y server '/opt/my app'")).toEqual(['-y', 'server', '/opt/my app']);
	});

	it('honours escapes outside quotes and inside double quotes', () => {
		expect(splitArguments('a\\ b c')).toEqual(['a b', 'c']);
		expect(splitArguments('"say \\"hi\\""')).toEqual(['say "hi"']);
		expect(splitArguments("'literal \\n backslash'")).toEqual(['literal \\n backslash']);
	});

	it('preserves empty quoted arguments and stray quotes', () => {
		expect(splitArguments('a "" b')).toEqual(['a', '', 'b']);
		expect(splitArguments('"unterminated')).toEqual(['unterminated']);
	});

	it('returns nothing for blank input', () => {
		expect(splitArguments('')).toEqual([]);
		expect(splitArguments('   ')).toEqual([]);
	});
});

describe('formatArguments', () => {
	it('only quotes arguments that need it', () => {
		expect(formatArguments(['-y', '@scope/server', '/tmp'])).toBe('-y @scope/server /tmp');
		expect(formatArguments(['C:/Program Files/app'])).toBe('"C:/Program Files/app"');
	});

	it('round-trips values that contain spaces, quotes, or backslashes', () => {
		const args = ['-y', 'server', 'C:/Program Files/my app', 'say "hi"', 'C:\\Users\\me', ''];
		expect(splitArguments(formatArguments(args))).toEqual(args);
	});
});

describe('sanitizeServerName', () => {
	it('slugs characters that cannot appear in a config key', () => {
		expect(sanitizeServerName('my.server')).toBe('my-server');
		expect(sanitizeServerName('  spaced name  ')).toBe('spaced-name');
		expect(sanitizeServerName('keeps_under-scores')).toBe('keeps_under-scores');
		expect(sanitizeServerName('!!!')).toBe('server');
	});
});

describe('parseMcpServersJson', () => {
	it('reads an mcpServers block into stdio configs', () => {
		const outcome = parseMcpServersJson(JSON.stringify({
			mcpServers: {
				filesystem: { command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'] },
			},
		}));

		expect(outcome).toEqual({
			ok: true,
			servers: [{ name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], enabled: true }],
			skipped: [],
		});
	});

	it('accepts a bare map, an array, and an argv-style command', () => {
		const bare = parseMcpServersJson('{"memory": {"command": "npx", "args": ["-y", "server-memory"]}}');
		expect(bare.ok && bare.servers[0]?.name).toBe('memory');

		const array = parseMcpServersJson('{"servers": [{"name": "git", "command": "npx", "args": ["-y", "s"]}]}');
		expect(array.ok && array.servers.map((server) => server.name)).toEqual(['git']);

		const argv = parseMcpServersJson('{"mcpServers": {"s": {"command": ["npx", "-y", "server"]}}}');
		expect(argv.ok && argv.servers[0]).toMatchObject({ name: 's', command: 'npx', args: ['-y', 'server'] });
	});

	it('maps env, headers, url, timeout, and disabled', () => {
		const outcome = parseMcpServersJson(JSON.stringify({
			mcpServers: {
				remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer t' }, timeout: 5000, disabled: true },
				tokened: { command: 'npx', args: ['-y', 's'], env: { API_KEY: 'abc', PORT: 8080 } },
			},
		}));

		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.servers[0]).toMatchObject({
			name: 'remote',
			url: 'https://example.com/mcp',
			headers: { Authorization: 'Bearer t' },
			timeout: 5000,
			enabled: false,
		});
		expect(outcome.servers[1]).toMatchObject({ name: 'tokened', env: { API_KEY: 'abc', PORT: '8080' }, enabled: true });
	});

	it('tolerates comments and trailing commas', () => {
		const outcome = parseMcpServersJson(`{
			// the reference server
			"mcpServers": { "everything": { "command": "npx", "args": ["-y", "server-everything"], }, },
		}`);
		expect(outcome.ok && outcome.servers[0]?.name).toBe('everything');
	});

	it('reports unusable entries instead of dropping them silently', () => {
		const outcome = parseMcpServersJson('{"mcpServers": {"good": {"command": "npx"}, "bad": {"description": "no target"}}}');
		expect(outcome.ok).toBe(true);
		if (!outcome.ok) return;
		expect(outcome.servers.map((server) => server.name)).toEqual(['good']);
		expect(outcome.skipped).toEqual(['bad']);
	});

	it('fails with a reason when nothing can be imported', () => {
		expect(parseMcpServersJson('')).toEqual({ ok: false, error: 'Nothing to import' });
		expect(parseMcpServersJson('{oops}')).toMatchObject({ ok: false });
		expect(parseMcpServersJson('[]')).toMatchObject({ ok: false });
		expect(parseMcpServersJson('{"unrelated": true}')).toMatchObject({ ok: false });
		expect(parseMcpServersJson('{"mcpServers": {"bad": {"description": "x"}}}')).toMatchObject({ ok: false });
	});
});

describe('preset catalog', () => {
	it('has unique ids and complete commands', () => {
		const ids = MCP_PRESETS.map((preset) => preset.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const preset of MCP_PRESETS) {
			expect(preset.id).toMatch(/^[a-z0-9-]+$/);
			expect(preset.command).not.toBe('');
			for (const arg of preset.args ?? []) expect(arg).not.toBe('');
		}
	});

	it('names only preset env keys without values', () => {
		for (const preset of MCP_PRESETS) {
			for (const key of Object.keys(preset.env ?? {})) expect(key).toMatch(/^[A-Z][A-Z0-9_]*$/);
		}
	});
});
