import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sanitizeToolName, formatMcpToolName } from '../integrations/mcp/client.js';
import {
	findMcpScope,
	loadConfig,
	mcpScopePath,
	readConfigFile,
	removeMcpServerConfig,
	saveMcpServer,
	setMcpServerEnabled,
} from '../services/config.js';

describe('MCP tool name formatting', () => {
	it('sanitizes tool names', () => {
		expect(sanitizeToolName('hello-world')).toBe('hello_world');
		expect(sanitizeToolName('test.tool')).toBe('test_tool');
		expect(sanitizeToolName('simple')).toBe('simple');
		expect(sanitizeToolName('with spaces')).toBe('with_spaces');
		expect(sanitizeToolName('')).toBe('');
	});

	it('formats combined server+tool names', () => {
		expect(formatMcpToolName('filesystem', 'read_file')).toBe('filesystem_read_file');
		expect(formatMcpToolName('my-server', 'list-files')).toBe('my_server_list_files');
	});

	it('handles special characters', () => {
		expect(sanitizeToolName('a.b:c/d')).toBe('a_b_c_d');
		expect(formatMcpToolName('server-1', 'tool@2')).toBe('server_1_tool_2');
	});
});

describe('scope-aware MCP config persistence', () => {
	function withScopes(run: (cwd: string) => void): void {
		const home = mkdtempSync(join(tmpdir(), 'spectra-home-'));
		const cwd = mkdtempSync(join(tmpdir(), 'spectra-project-'));
		const previousHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = home;
		try {
			run(cwd);
		} finally {
			if (previousHome === undefined) delete process.env.SPECTRA_HOME;
			else process.env.SPECTRA_HOME = previousHome;
			rmSync(home, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		}
	}

	it('writes a server into only the requested scope', () => {
		withScopes((cwd) => {
			const entry = { name: 'filesystem', command: 'npx', args: ['-y', 'server'], enabled: true };
			saveMcpServer(entry, 'project', cwd);

			expect(readConfigFile(mcpScopePath('project', cwd)).mcp).toEqual([entry]);
			expect(readConfigFile(mcpScopePath('global', cwd)).mcp).toBeUndefined();
			expect(findMcpScope('filesystem', cwd)).toBe('project');
			expect(loadConfig(cwd).mcp).toEqual([entry]);
		});
	});

	it('replaces an existing entry in place and toggles or removes it', () => {
		withScopes((cwd) => {
			saveMcpServer({ name: 'github', url: 'https://example.com/mcp', enabled: true }, 'global', cwd);
			saveMcpServer({ name: 'github', url: 'https://example.com/mcp', enabled: false }, 'global', cwd);
			expect(readConfigFile(mcpScopePath('global', cwd)).mcp).toHaveLength(1);
			expect(findMcpScope('github', cwd)).toBe('global');

			expect(setMcpServerEnabled('github', true, cwd)).toBe(true);
			expect(readConfigFile(mcpScopePath('global', cwd)).mcp?.[0]?.enabled).toBe(true);
			expect(setMcpServerEnabled('missing', true, cwd)).toBe(false);

			expect(removeMcpServerConfig('github', cwd)).toBe('global');
			expect(readConfigFile(mcpScopePath('global', cwd)).mcp).toEqual([]);
			expect(removeMcpServerConfig('github', cwd)).toBeUndefined();
		});
	});
});
