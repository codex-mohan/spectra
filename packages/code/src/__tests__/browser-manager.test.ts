import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser } from 'puppeteer-core';

const connectMock = vi.fn();
const launchMock = vi.fn();
vi.mock('puppeteer-core', () => ({
	default: { connect: connectMock, launch: launchMock },
}));

const { BrowserManager } = await import('../browser/manager.js');

class FakePage {
	urlValue = 'about:blank';
	titleValue = 'New Tab';
	handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	closed = false;
	gotoCalls: string[] = [];
	on(event: string, handler: (...args: unknown[]) => void) { const list = this.handlers.get(event) ?? []; list.push(handler); this.handlers.set(event, list); }
	emit(event: string, ...args: unknown[]) { for (const handler of this.handlers.get(event) ?? []) handler(...args); }
	url() { return this.urlValue; }
	async title() { return this.titleValue; }
	async goto(url: string) { this.gotoCalls.push(url); this.urlValue = url; }
	async setViewport() {}
	async setRequestInterception() {}
	async setDefaultTimeout() {}
	async setDefaultNavigationTimeout() {}
	async evaluate() { return []; }
	async screenshot() { return new Uint8Array(); }
	async close() { this.closed = true; this.emit('close'); }
	async createCDPSession() { return { send: vi.fn() }; }
	keyboard = { type: async () => {}, press: async () => {}, down: async () => {}, up: async () => {} };
	async waitForSelector() {}
}

class FakeContext {
	pages: FakePage[] = [];
	closed = false;
	async newPage() { const page = new FakePage(); this.pages.push(page); return page; }
	async close() { this.closed = true; for (const page of this.pages) await page.close().catch(() => {}); }
}

class FakeBrowser {
	connected = true;
	contexts: FakeContext[] = [];
	handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	on(event: string, handler: (...args: unknown[]) => void) { const list = this.handlers.get(event) ?? []; list.push(handler); this.handlers.set(event, list); }
	emit(event: string, ...args: unknown[]) { for (const handler of this.handlers.get(event) ?? []) handler(...args); }
	async createBrowserContext() { const context = new FakeContext(); this.contexts.push(context); return context; }
	process() { return { kill: vi.fn() }; }
	async close() { this.connected = false; this.emit('disconnected'); }
	disconnect() { this.connected = false; this.emit('disconnected'); }
}

beforeEach(() => {
	connectMock.mockReset();
	launchMock.mockReset();
});

describe('BrowserManager', () => {
	function manager() {
		return new BrowserManager(() => ({ cdpUrl: 'http://127.0.0.1:9222', timeoutMs: 1000, idleCloseSec: 1800, headless: true }));
	}

	it('reuses a named tab and isolates sessions', async () => {
		const browser = new FakeBrowser();
		connectMock.mockResolvedValue(browser);
		const managerInstance = manager();
		const first = await managerInstance.open('s1', { url: 'https://one.test' });
		const again = await managerInstance.open('s1', { name: 'main' });
		expect(again).toBe(first);
		expect(browser.contexts).toHaveLength(1);
		expect(browser.contexts[0].pages).toHaveLength(1);

		const second = await managerInstance.open('s2');
		expect(second.sessionId).toBe('s2');
		expect(browser.contexts).toHaveLength(2);
		await managerInstance.closeAll();
	});

	it('closes only the requested session', async () => {
		const browser = new FakeBrowser();
		connectMock.mockResolvedValue(browser);
		const managerInstance = manager();
		await managerInstance.open('s1');
		await managerInstance.open('s2');
		await managerInstance.closeSession('s1');
		expect(browser.contexts[0].closed).toBe(true);
		expect(browser.contexts[1].closed).toBe(false);
		expect(managerInstance.list('s1')).toHaveLength(0);
		expect(managerInstance.list('s2')).toHaveLength(1);
		await managerInstance.closeAll();
	});

	it('relaunches lazily after the browser disconnects', async () => {
		const first = new FakeBrowser();
		const second = new FakeBrowser();
		connectMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
		const managerInstance = manager();
		await managerInstance.open('s1');
		first.emit('disconnected');
		expect(managerInstance.status().connected).toBe(false);
		await managerInstance.open('s1');
		expect(connectMock).toHaveBeenCalledTimes(2);
		await managerInstance.closeAll();
	});

	it('refuses to open when disabled', async () => {
		const managerInstance = new BrowserManager(() => ({ enabled: false }));
		await expect(managerInstance.open('s1')).rejects.toThrow(/disabled/);
	});

	it('closes idle tabs unless persisted', async () => {
		vi.useFakeTimers();
		try {
			const browser = new FakeBrowser();
			connectMock.mockResolvedValue(browser);
			const managerInstance = new BrowserManager(() => ({ cdpUrl: 'http://127.0.0.1:9222', timeoutMs: 1000, idleCloseSec: 1 }));
			await managerInstance.open('s1', { persist: true });
			await managerInstance.open('s1', { name: 'transient' });
			await vi.advanceTimersByTimeAsync(31_000);
			expect(managerInstance.list('s1').map((tab) => tab.name)).toEqual(['main']);
			await managerInstance.closeAll();
		} finally {
			vi.useRealTimers();
		}
	});
});
