import { describe, expect, it } from 'vitest';
import { createSecurityManager } from '../security/index.js';
import type { PermissionRequest } from '../security/types.js';
import { createAllToolsWithSecurity } from '../tools/index.js';
import type { AgentTool } from '@mohanscodex/spectra-agent';
import type { Model } from '@mohanscodex/spectra-ai';

const testModel: Model = {
	id: 'test-model',
	name: 'Test Model',
	provider: 'test-provider',
	api: 'test-api',
};

function toolByName(tools: AgentTool[], name: string): AgentTool {
	const tool = tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`Missing tool: ${name}`);
	return tool;
}

describe('tool permissions', () => {
	it('does not prompt for safe orchestration tools', async () => {
		const security = createSecurityManager();
		const requests: PermissionRequest[] = [];
		security.setListener((request) => {
			requests.push(request);
			security.respondToRequest(request.id, { action: 'deny' });
		});
		const tools = createAllToolsWithSecurity(security, { model: testModel });

		const task = toolByName(tools, 'task');
		const result = await task.execute('call-1', {
			description: 'Invalid subagent',
			prompt: 'Do something',
			subagent_type: 'not-a-subagent',
		});

		expect(requests).toHaveLength(0);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.type).toBe('text');
		expect(result.content[0]?.text).toContain('Unknown subagent');
	});

	it('does not prompt before web fetch validation', async () => {
		const security = createSecurityManager();
		const requests: PermissionRequest[] = [];
		security.setListener((request) => {
			requests.push(request);
			security.respondToRequest(request.id, { action: 'deny' });
		});
		const tools = createAllToolsWithSecurity(security, { model: testModel });

		const webFetch = toolByName(tools, 'web_fetch');
		const result = await webFetch.execute('call-1', { url: 'not a url' });

		expect(requests).toHaveLength(0);
		expect(result.isError).toBe(true);
		expect(result.content[0]?.type).toBe('text');
		expect(result.content[0]?.text).toContain('Invalid URL');
	});

	it('still prompts for file access outside the working directory', async () => {
		const security = createSecurityManager();
		const requests: PermissionRequest[] = [];
		security.setListener((request) => {
			requests.push(request);
			security.respondToRequest(request.id, { action: 'deny' });
		});
		const tools = createAllToolsWithSecurity(security, { model: testModel });

		const read = toolByName(tools, 'read');
		const result = await read.execute('call-1', { path: '../outside-working-directory.txt' });

		expect(requests.length).toBeGreaterThan(0);
		expect(requests[0]?.permission).toBe('external_directory');
		expect(result.isError).toBe(true);
		expect(result.content[0]?.type).toBe('text');
		expect(result.content[0]?.text).toContain('External file access denied');
	});
});
