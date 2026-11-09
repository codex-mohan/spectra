import { describe, expect, it, vi } from 'vitest';
import type { Page } from 'puppeteer-core';
import { BrowserTab } from '../browser/tab.js';

class FakePage {
	private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
	currentUrl = 'https://example.test/';
	observeResult: unknown[] = [];
	clicked = false;
	typed: string[] = [];
	pressed: string[] = [];
	constructor(private readonly scriptResult: (script: string) => unknown = () => true) {}
	on(event: string, handler: (...args: unknown[]) => void) { const list = this.handlers.get(event) ?? []; list.push(handler); this.handlers.set(event, list); }
	emit(event: string, ...args: unknown[]) { for (const handler of this.handlers.get(event) ?? []) handler(...args); }
	url() { return this.currentUrl; }
	async title() { return 'Example'; }
	async goto(url: string) { this.currentUrl = url; }
	async evaluate(script: string) {
		if (String(script).includes('window.__spectraRefs = visible')) return this.observeResult;
		return this.scriptResult(String(script));
	}
	async setViewport() {}
	async setRequestInterception() {}
	async setDefaultTimeout() {}
	async setDefaultNavigationTimeout() {}
	async waitForSelector() {}
	async screenshot() { return new Uint8Array([137, 80, 78, 71]); }
	async close() {}
	async createCDPSession() { return { send: vi.fn() }; }
	keyboard = {
		type: async (text: string) => { this.typed.push(text); },
		press: async (key: string) => { this.pressed.push(key); },
		down: async () => {},
		up: async () => {},
	};
}

function tabWith(scriptResult?: (script: string) => unknown) {
	const page = new FakePage(scriptResult);
	const tab = new BrowserTab('main', 'session-1', page as unknown as Page, { timeoutMs: 1000 });
	return { page, tab };
}

describe('BrowserTab', () => {
	it('invalidates refs after navigation', async () => {
		const { page, tab } = tabWith();
		page.observeResult = [{ id: 'e1', role: 'button', name: 'Go', tag: 'button' }];
		const observed = await tab.observe({});
		expect(observed.elements).toHaveLength(1);
		page.emit('framenavigated');
		await expect(tab.click({ ref: 'e1' })).rejects.toThrow(/stale/);
	});

	it('clicks a valid ref and types text', async () => {
		const { page, tab } = tabWith(() => true);
		page.observeResult = [{ id: 'e1', role: 'textbox', name: 'Name', tag: 'input' }];
		await tab.observe({});
		await tab.click({ ref: 'e1' });
		await tab.type({ ref: 'e1', text: 'hello', submit: true });
		expect(page.typed).toEqual(['hello']);
		expect(page.pressed).toEqual(['Enter']);
	});

	it('rejects invalid refs', async () => {
		const { tab } = tabWith();
		await tab.observe({});
		await expect(tab.click({ ref: 'e9' })).rejects.toThrow(/stale/);
	});
});
