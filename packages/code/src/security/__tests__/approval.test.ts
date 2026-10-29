import { describe, expect, it, vi } from 'vitest';
import { createSecurityManager } from '../index.js';
import type { PermissionRequest } from '../types.js';

function manager(mode: 'always-ask' | 'write' | 'yolo', extra: Parameters<typeof createSecurityManager>[0] = {}) {
	return createSecurityManager({ approvalMode: mode, cwd: process.cwd(), ...extra });
}

describe('approval modes', () => {
	it('write mode allows read and write without a listener', async () => {
		const security = manager('write');
		await expect(security.checkPermission('read', ['a.ts'], 'read', '', { tier: 'read' })).resolves.toBeUndefined();
		await expect(security.checkPermission('write', ['a.ts'], 'write', '', { tier: 'write' })).resolves.toBeUndefined();
	});

	it('write mode prompts for exec', async () => {
		const security = manager('write');
		const requests: PermissionRequest[] = [];
		security.setListener((request) => {
			requests.push(request);
			security.respondToRequest(request.id, { action: 'deny' });
		});
		await expect(security.checkPermission('shell', ['echo hi'], 'shell', '', { tier: 'exec' })).rejects.toThrow('Permission denied');
		expect(requests).toHaveLength(1);
	});

	it('always-ask prompts for writes but not reads', async () => {
		const security = manager('always-ask');
		await expect(security.checkPermission('read', ['a.ts'], 'read', '', { tier: 'read' })).resolves.toBeUndefined();
		await expect(security.checkPermission('write', ['a.ts'], 'write', '', { tier: 'write' })).rejects.toThrow('no interactive approval');
	});

	it('yolo allows exec but external paths still prompt', async () => {
		const security = manager('yolo');
		await expect(security.checkPermission('shell', ['echo hi'], 'shell', '', { tier: 'exec' })).resolves.toBeUndefined();
		await expect(security.checkPermission('external_directory', ['../outside.ts'], 'read', '', { tier: 'write', external: true })).rejects.toThrow('no interactive approval');
	});
});

describe('rules and policies', () => {
	it('a deny rule blocks the call', async () => {
		const security = manager('yolo', { config: { write: { 'secret.ts': 'deny' } } });
		await expect(security.checkPermission('write', ['secret.ts'], 'write', '', { tier: 'write' })).rejects.toThrow('deny permission rule');
	});

	it('a tool policy deny wins over yolo', async () => {
		const security = manager('yolo', { approval: { bash: 'deny' } });
		await expect(security.checkPermission('shell', ['ls'], 'shell', '', { tier: 'exec' })).rejects.toThrow('tools.approval');
	});

	it('a tool policy allow bypasses the mode', async () => {
		const security = manager('always-ask', { approval: { shell: 'allow' } });
		await expect(security.checkPermission('shell', ['ls'], 'shell', '', { tier: 'exec' })).resolves.toBeUndefined();
	});

	it('scopes always-allow to the approved file instead of *', async () => {
		const security = manager('always-ask');
		security.setListener((request) => {
			security.respondToRequest(request.id, { action: 'always' });
		});
		await security.checkPermission('write', ['src/a.ts'], 'write', '', { tier: 'write' });
		const approved = security.getApprovedConfig();
		const patterns = Object.keys(approved.write ?? {});
		expect(patterns).toContain('src/a.ts');
		expect(patterns).not.toContain('*');
	});
});
