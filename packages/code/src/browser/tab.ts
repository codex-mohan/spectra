import type { Page } from 'puppeteer-core';
import type { BrowserConfig } from '../services/config.js';

export interface ObservedElement {
	id: string;
	role: string;
	name: string;
	tag: string;
	value?: string;
}

export interface ObserveOptions {
	includeAll?: boolean;
	viewportOnly?: boolean;
	selector?: string;
}

export interface TabOptions {
	timeoutMs?: number;
	screenshotDir?: string;
}

function timeoutFor(tab: BrowserTab, value?: number): number {
	return Math.min(300_000, Math.max(1_000, value ?? tab.timeoutMs));
}

export class BrowserTab {
	readonly name: string;
	readonly sessionId: string;
	readonly page: Page;
	timeoutMs: number;
	readonly allowedDomains: readonly string[];
	readonly screenshotDir?: string;
	createdAt = Date.now();
	lastUsedAt = Date.now();
	frozen = false;
	private refsValid = false;
	private refCount = 0;
	private cdp?: Awaited<ReturnType<Page['createCDPSession']>>;
	private navigating = false;

	constructor(
		name: string,
		sessionId: string,
		page: Page,
		config: BrowserConfig,
		allowedDomains: readonly string[] = [],
	) {
		this.name = name;
		this.sessionId = sessionId;
		this.page = page;
		this.timeoutMs = config.timeoutMs ?? 30_000;
		this.allowedDomains = [...allowedDomains];
		this.screenshotDir = config.screenshotDir;
		void page.setDefaultTimeout(this.timeoutMs);
		void page.setDefaultNavigationTimeout(this.timeoutMs);
		page.on('framenavigated', () => {
			this.refsValid = false;
			this.refCount = 0;
			this.navigating = false;
		});
		page.on('load', () => { this.navigating = false; });
	}

	touch(): void {
		this.lastUsedAt = Date.now();
	}

	get url(): string {
		return this.page.url();
	}

	async title(): Promise<string> {
		return this.page.title();
	}

	async goto(url: string, timeout?: number): Promise<void> {
		this.touch();
		await this.unfreeze();
		this.navigating = true;
		await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutFor(this, timeout) });
		this.navigating = false;
	}

	async observe(options: ObserveOptions = {}): Promise<{ elements: ObservedElement[]; url: string; title: string }> {
		this.touch();
		await this.unfreeze();
		const limit = 200;
		const includeAll = options.includeAll === true;
		const viewportOnly = options.viewportOnly !== false;
		const selector = (options.selector ?? '').trim();
		const script = `(() => {
			const selector = ${JSON.stringify(selector)};
			const includeAll = ${includeAll};
			const viewportOnly = ${viewportOnly};
			const base = selector || 'a,button,input,select,textarea,summary,[role="button"],[role="link"],[role="checkbox"],[role="menuitem"],[role="tab"],[contenteditable="true"]';
			const candidates = [...document.querySelectorAll(base)];
			const visible = candidates.filter((el) => {
				if (!(el instanceof HTMLElement)) return false;
				if (el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return false;
				const rect = el.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) return false;
				const style = getComputedStyle(el);
				if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') return false;
				if (viewportOnly && (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth)) return false;
				if (!includeAll) {
					const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim();
					const tag = el.tagName.toLowerCase();
					if (!name && !['input', 'select', 'textarea'].includes(tag)) return false;
				}
				return true;
			}).slice(0, ${limit});
			window.__spectraRefs = visible;
			const roleFor = (el) => {
				const explicit = el.getAttribute('role');
				if (explicit) return explicit;
				const tag = el.tagName.toLowerCase();
				if (tag === 'a') return 'link';
				if (tag === 'button') return 'button';
				if (tag === 'textarea') return 'textbox';
				if (tag === 'select') return 'combobox';
				if (tag === 'input') {
					const type = (el.getAttribute('type') || 'text').toLowerCase();
					if (type === 'checkbox') return 'checkbox';
					if (type === 'radio') return 'radio';
					if (type === 'submit' || type === 'button') return 'button';
					return 'textbox';
				}
				return tag;
			};
			const nameFor = (el) => {
				const labelled = el.getAttribute('aria-labelledby');
				if (labelled) {
					const parts = labelled.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
					if (parts) return parts;
				}
				return (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('alt') || el.getAttribute('title') || el.innerText || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 200);
			};
			return visible.map((el, index) => ({
				id: 'e' + (index + 1),
				role: roleFor(el),
				name: nameFor(el),
				tag: el.tagName.toLowerCase(),
				value: 'value' in el && typeof el.value === 'string' ? el.value.slice(0, 200) : undefined,
			}));
		})()`;
		const elements = await this.page.evaluate(script) as ObservedElement[];
		this.refsValid = true;
		this.refCount = elements.length;
		return { elements, url: this.url, title: await this.title() };
	}

	private ensureRefs(): void {
		if (!this.refsValid) throw new Error('Element references are stale after navigation. Call browser_observe again.');
	}

	async click(input: { ref?: string; selector?: string; button?: 'left' | 'right' | 'middle'; count?: number }): Promise<void> {
		this.touch();
		await this.unfreeze();
		if (input.selector) {
			await this.page.click(input.selector, { button: input.button, count: input.count });
			return;
		}
		if (!input.ref) throw new Error('browser_click requires ref or selector');
		this.ensureRefs();
		const index = parseRef(input.ref, this.refCount);
		const clicked = await this.page.evaluate(`(() => {
			const el = window.__spectraRefs?.[${index}];
			if (!el) return false;
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.focus?.();
			el.click();
			return true;
		})()`) as boolean;
		if (!clicked) throw new Error(`Element reference ${input.ref} is stale. Call browser_observe again.`);
	}

	async type(input: { ref?: string; selector?: string; text: string; clear?: boolean; submit?: boolean }): Promise<void> {
		this.touch();
		await this.unfreeze();
		if (input.selector) {
			if (input.clear) await this.page.$eval(input.selector, (element) => { if ('value' in element) (element as HTMLInputElement).value = ''; });
			await this.page.type(input.selector, input.text, { delay: 0 });
			if (input.submit) await this.page.keyboard.press('Enter');
			return;
		}
		if (!input.ref) throw new Error('browser_type requires ref or selector');
		this.ensureRefs();
		const index = parseRef(input.ref, this.refCount);
		const focused = await this.page.evaluate(`(() => {
			const el = window.__spectraRefs?.[${index}];
			if (!el) return false;
			el.scrollIntoView({ block: 'center', inline: 'center' });
			el.focus?.();
			return true;
		})()`) as boolean;
		if (!focused) throw new Error(`Element reference ${input.ref} is stale. Call browser_observe again.`);
		if (input.clear) {
			await this.page.keyboard.down('Control');
			await this.page.keyboard.press('A');
			await this.page.keyboard.up('Control');
		}
		if (input.text) await this.page.keyboard.type(input.text);
		if (input.submit) await this.page.keyboard.press('Enter');
	}

	async extract(input: { selector?: string; format?: 'text' | 'html' | 'value' | 'attr'; attr?: string }): Promise<string> {
		this.touch();
		await this.unfreeze();
		const selector = input.selector ?? 'body';
		const format = input.format ?? 'text';
		const attr = input.attr;
		const result = await this.page.evaluate(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const format = ${JSON.stringify(format)};
			const attr = ${JSON.stringify(attr ?? '')};
			if (format === 'html') return el.innerHTML;
			if (format === 'value') return 'value' in el ? String(el.value) : '';
			if (format === 'attr') return attr ? el.getAttribute(attr) : null;
			return el.innerText ?? el.textContent ?? '';
		})()`);
		if (result === null) throw new Error(`Selector not found: ${selector}`);
		return String(result).slice(0, 64 * 1024);
	}

	async wait(input: { selector?: string; text?: string; url?: string; timeout?: number }): Promise<void> {
		this.touch();
		await this.unfreeze();
		const timeout = timeoutFor(this, input.timeout);
		if (input.selector) {
			await this.page.waitForSelector(input.selector, { timeout });
			return;
		}
		if (input.text) {
			await this.page.waitForFunction(
				(needle) => (document.body?.innerText || '').includes(needle),
				{ timeout },
				input.text,
			);
			return;
		}
		if (input.url) {
			const deadline = Date.now() + timeout;
			while (Date.now() < deadline) {
				if (this.page.url().includes(input.url)) return;
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			throw new Error(`Timed out waiting for URL containing ${input.url}`);
		}
		throw new Error('browser_wait requires selector, text, or url');
	}

	async screenshot(input: { fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number; selector?: string } = {}): Promise<Uint8Array> {
		this.touch();
		await this.unfreeze();
		const options = {
			type: input.type ?? 'png',
			quality: input.type === 'jpeg' ? (input.quality ?? 70) : undefined,
			encoding: 'binary' as const,
		};
		if (input.selector) {
			const element = await this.page.$(input.selector);
			if (!element) throw new Error(`Selector not found: ${input.selector}`);
			return element.screenshot(options);
		}
		return this.page.screenshot({ ...options, fullPage: input.fullPage });
	}

	async viewportSize(): Promise<{ width: number; height: number }> {
		return this.page.evaluate('({ width: innerWidth, height: innerHeight })') as Promise<{ width: number; height: number }>;
	}

	async resizeForModel(maxWidth = 1024, maxHeight = 1024): Promise<{ width: number; height: number } | undefined> {
		const current = await this.viewportSize();
		const scale = Math.min(1, maxWidth / Math.max(1, current.width), maxHeight / Math.max(1, current.height));
		if (scale >= 1) return undefined;
		const width = Math.max(320, Math.floor(current.width * scale));
		const height = Math.max(200, Math.floor(current.height * scale));
		await this.page.setViewport({ width, height });
		return current;
	}

	async restoreViewport(size: { width: number; height: number }): Promise<void> {
		await this.page.setViewport({ width: size.width, height: size.height });
	}

	private async cdpSession(): Promise<Awaited<ReturnType<Page['createCDPSession']>>> {
		if (!this.cdp) this.cdp = await this.page.createCDPSession();
		return this.cdp;
	}

	async freeze(): Promise<void> {
		if (this.frozen) return;
		this.frozen = true;
		try {
			const cdp = await this.cdpSession();
			await cdp.send('Page.setWebLifecycleState', { state: 'frozen' });
		} catch {
			// Freezing is best-effort; some Chrome builds reject the lifecycle state.
		}
	}

	async unfreeze(): Promise<void> {
		if (!this.frozen) return;
		this.frozen = false;
		try {
			const cdp = await this.cdpSession();
			await cdp.send('Page.setWebLifecycleState', { state: 'active' });
		} catch {}
	}

	async close(): Promise<void> {
		try {
			await this.page.close();
		} catch {}
	}
}

function parseRef(ref: string, count: number): number {
	const match = /^e?(\d+)$/i.exec(ref.trim());
	if (!match) throw new Error(`Invalid element reference: ${ref}`);
	const index = Number(match[1]) - 1;
	if (index < 0 || index >= count) throw new Error(`Element reference ${ref} is stale. Call browser_observe again.`);
	return index;
}
