import { describe, expect, it, vi } from 'vitest';
import { createBrowserTools, screenshotSessionDirName } from '../tools/browser.js';
import { PermissionDeniedError } from '../security/index.js';
import type { SecurityManager } from '../security/index.js';
import type { BrowserManager } from '../browser/manager.js';

function fakeManager() {
	const tab = {
		name: 'main',
		url: 'https://example.test/',
		title: vi.fn(async () => 'Example'),
		observe: vi.fn(async () => ({ elements: [{ id: 'e1', role: 'button', name: 'Go', tag: 'button' }], url: 'https://example.test/', title: 'Example' })),
		click: vi.fn(async () => {}),
		type: vi.fn(async () => {}),
		extract: vi.fn(async () => 'hello'),
		wait: vi.fn(async () => {}),
		screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
		viewportSize: vi.fn(async () => ({ width: 800, height: 600 })),
		resizeForModel: vi.fn(async () => undefined),
		restoreViewport: vi.fn(async () => {}),
		goto: vi.fn(async () => {}),
	};
	return {
		tab,
		manager: {
			open: vi.fn(async () => tab),
			get: vi.fn(() => tab),
			closeTab: vi.fn(async () => true),
			closeSession: vi.fn(async () => {}),
		} as unknown as BrowserManager,
	};
}

function tool(tools: ReturnType<typeof createBrowserTools>, name: string) {
	return tools.find((candidate) => candidate.name === name)!;
}

const context = { toolCallId: 'call-1', sessionId: 'session-1', signal: new AbortController().signal };

describe('browser tools', () => {
	it('turns the browser session key into a filesystem-safe directory', () => {
		expect(screenshotSessionDirName('abc-123:session')).toBe('abc-123_session');
		expect(screenshotSessionDirName('a:b/c\\d*e?f"g<h>i|j')).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
		expect(screenshotSessionDirName('')).toBe('session');
	});

	it('requires a session id', async () => {
		const { manager } = fakeManager();
		const tools = createBrowserTools({ manager });
		const result = await tool(tools, 'browser_open').execute({}, { toolCallId: 'x' });
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: 'Browser tools require a session id' });
	});

	it('checks the browser permission on open', async () => {
		const { manager } = fakeManager();
		const security = {
			checkPermission: vi.fn(async () => { throw new PermissionDeniedError('browser', 'example.test', 'denied'); }),
		} as unknown as SecurityManager;
		const tools = createBrowserTools({ manager, security });
		const result = await tool(tools, 'browser_open').execute({ url: 'https://example.test/' }, context);
		expect(result.isError).toBe(true);
		expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Permission denied') });
		expect(manager.open).not.toHaveBeenCalled();
	});

	it('rejects SSRF-blocked URLs before opening', async () => {
		const { manager } = fakeManager();
		const tools = createBrowserTools({ manager });
		const result = await tool(tools, 'browser_open').execute({ url: 'http://127.0.0.1:3000/' }, context);
		expect(result.isError).toBe(true);
		expect(manager.open).not.toHaveBeenCalled();
	});

	it('formats observed elements with refs', async () => {
		const { manager } = fakeManager();
		const tools = createBrowserTools({ manager });
		const result = await tool(tools, 'browser_observe').execute({}, context);
		expect(result.content[0]).toMatchObject({ type: 'text' });
		expect((result.content[0] as { text: string }).text).toContain('e1  button  Go');
	});

	it('closes only the current session', async () => {
		const { manager } = fakeManager();
		const tools = createBrowserTools({ manager });
		const result = await tool(tools, 'browser_close').execute({ all: true }, context);
		expect(result.isError).toBeUndefined();
		expect(manager.closeSession).toHaveBeenCalledWith('session-1');
	});
});
