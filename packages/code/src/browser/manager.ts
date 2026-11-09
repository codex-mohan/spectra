import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import puppeteer, { type Browser, type BrowserContext, type Page } from 'puppeteer-core';
import { loadConfig, type BrowserConfig } from '../services/config.js';
import { getGlobalConfigDir } from '../utils/paths.js';
import { checkRequestUrl } from './network.js';
import { BrowserTab } from './tab.js';
import { browserExecutableError, resolveBrowserExecutable } from './executable.js';
import { SsrfGuard } from '../security/ssrf-guard.js';

export interface OpenTabOptions {
	name?: string;
	url?: string;
	viewport?: { width: number; height: number; scale?: number };
	allowedDomains?: string[];
	headed?: boolean;
	timeout?: number;
	persist?: boolean;
}

export interface BrowserStatus {
	connected: boolean;
	mode: 'managed' | 'attached';
	tabs: Array<{ name: string; sessionId: string; url: string; title?: string; frozen: boolean; persist: boolean }>;
}

type TabEntry = { tab: BrowserTab; persist: boolean };

const IDLE_SWEEP_MS = 30_000;

function keyFor(sessionId: string, name: string): string {
	return `${sessionId}\u0000${name}`;
}

export class BrowserManager {
	private browser: Browser | null = null;
	private launching: Promise<Browser> | null = null;
	private readonly contexts = new Map<string, BrowserContext>();
	private readonly tabs = new Map<string, TabEntry>();
	private readonly ownedProcessProfile = new Set<string>();
	private idleTimer: ReturnType<typeof setInterval> | null = null;
	private mode: 'managed' | 'attached' = 'managed';
	private closing = false;

	constructor(private readonly configProvider: () => BrowserConfig = () => loadConfig().browser ?? {}) {}

	private config(): BrowserConfig {
		return this.configProvider();
	}

	private ssrf(): SsrfGuard {
		return new SsrfGuard(loadConfig().security?.ssrf);
	}

	private async ensureBrowser(): Promise<Browser> {
		if (this.browser?.connected) return this.browser;
		if (this.launching) return this.launching;
		const config = this.config();
		if (config.enabled === false) throw new Error('Browser automation is disabled by browser.enabled=false');
		this.launching = (async () => {
			if (config.cdpUrl?.trim()) {
				this.mode = 'attached';
				const browser = await puppeteer.connect({
					browserURL: config.cdpUrl.trim(),
					defaultViewport: null,
				});
				this.attach(browser);
				return browser;
			}
			const executablePath = resolveBrowserExecutable({ configuredPath: config.executablePath });
			if (!executablePath) throw new Error(browserExecutableError({ configuredPath: config.executablePath }));
			this.mode = 'managed';
			const userDataDir = config.persistProfile
				? join(getGlobalConfigDir(), 'browser', 'profile')
				: mkdtempSync(join(tmpdir(), 'spectra-browser-'));
			if (config.persistProfile) mkdirSync(userDataDir, { recursive: true });
			const browser = await puppeteer.launch({
				executablePath,
				headless: config.headless !== false,
				userDataDir,
				timeout: Math.max(5_000, config.timeoutMs ?? 30_000),
				args: [
					'--no-first-run',
					'--no-default-browser-check',
					'--disable-background-networking',
					'--disable-component-update',
					'--disable-sync',
					'--disable-extensions',
					'--mute-audio',
					'--window-size=1280,800',
				],
			});
			this.ownedProcessProfile.add(userDataDir);
			this.attach(browser);
			return browser;
		})().finally(() => {
			this.launching = null;
		});
		return this.launching;
	}

	private attach(browser: Browser): void {
		this.browser = browser;
		browser.on('disconnected', () => {
			const wasClosing = this.closing;
			this.browser = null;
			this.contexts.clear();
			this.tabs.clear();
			if (!wasClosing) {
				// Tabs are gone; the next tool call relaunches lazily.
			}
		});
		if (!this.idleTimer) {
			this.idleTimer = setInterval(() => {
				void this.sweepIdle();
			}, IDLE_SWEEP_MS);
			this.idleTimer.unref?.();
		}
		process.once('exit', () => {
			try { browser.process()?.kill('SIGKILL'); } catch {}
		});
	}

	private async getContext(sessionId: string): Promise<BrowserContext> {
		const browser = await this.ensureBrowser();
		const existing = this.contexts.get(sessionId);
		if (existing) return existing;
		const context = await browser.createBrowserContext();
		this.contexts.set(sessionId, context);
		return context;
	}

	private async configureNetwork(page: Page, allowedDomains: readonly string[]): Promise<void> {
		await page.setRequestInterception(true);
		const guard = this.ssrf();
		page.on('request', (request) => {
			const check = checkRequestUrl(request.url(), { allowedDomains, ssrf: guard });
			if (check.ok) {
				void request.continue();
			} else {
				void request.abort('blockedbyclient');
			}
		});
	}

	async open(sessionId: string, options: OpenTabOptions = {}): Promise<BrowserTab> {
		const name = options.name?.trim() || 'main';
		const existing = this.tabs.get(keyFor(sessionId, name));
		if (existing) {
			existing.tab.touch();
			if (options.url) {
				const guard = this.ssrf();
				const check = checkRequestUrl(options.url, {
					allowedDomains: options.allowedDomains ?? existing.tab.allowedDomains,
					ssrf: guard,
				});
				if (!check.ok) throw new Error(check.reason);
				await existing.tab.goto(options.url, options.timeout);
			}
			return existing.tab;
		}

		const config = this.config();
		const allowedDomains = options.allowedDomains ?? config.allowedDomains ?? [];
		if (options.url) {
			const check = checkRequestUrl(options.url, { allowedDomains, ssrf: this.ssrf() });
			if (!check.ok) throw new Error(check.reason);
		}
		const context = await this.getContext(sessionId);
		const page = await context.newPage();
		let created = false;
		try {
			await this.configureNetwork(page, allowedDomains);
			const viewport = options.viewport ?? { width: 1280, height: 800 };
			await page.setViewport(viewport);
			const tab = new BrowserTab(name, sessionId, page, config, allowedDomains);
			created = true;
			if (options.url) {
				await tab.goto(options.url, options.timeout ?? config.timeoutMs);
			}
			this.tabs.set(keyFor(sessionId, name), { tab, persist: options.persist === true });
			return tab;
		} catch (error) {
			if (created) await page.close().catch(() => {});
			throw error;
		}
	}

	get(sessionId: string, name = 'main'): BrowserTab {
		const entry = this.tabs.get(keyFor(sessionId, name));
		if (!entry) throw new Error(`Browser tab "${name}" is not open for this session. Call browser_open first.`);
		entry.tab.touch();
		return entry.tab;
	}

	list(sessionId?: string): BrowserStatus['tabs'] {
		const entries = [...this.tabs.values()].filter(({ tab }) => !sessionId || tab.sessionId === sessionId);
		return entries.map(({ tab, persist }) => ({
			name: tab.name,
			sessionId: tab.sessionId,
			url: tab.url,
			frozen: tab.frozen,
			persist,
		}));
	}

	async freezeSession(sessionId: string): Promise<void> {
		for (const { tab } of this.tabs.values()) {
			if (tab.sessionId === sessionId) await tab.freeze();
		}
	}

	private async closeTabEntry(key: string): Promise<void> {
		const entry = this.tabs.get(key);
		if (!entry) return;
		this.tabs.delete(key);
		await entry.tab.close();
	}

	async closeTab(sessionId: string, name = 'main'): Promise<boolean> {
		const key = keyFor(sessionId, name);
		if (!this.tabs.has(key)) return false;
		await this.closeTabEntry(key);
		return true;
	}

	async closeSession(sessionId: string): Promise<void> {
		for (const [key, { tab }] of [...this.tabs]) {
			if (tab.sessionId === sessionId) await this.closeTabEntry(key);
		}
		const context = this.contexts.get(sessionId);
		this.contexts.delete(sessionId);
		if (context) await context.close().catch(() => {});
	}

	async closeAll(): Promise<void> {
		this.closing = true;
		for (const key of [...this.tabs.keys()]) await this.closeTabEntry(key);
		for (const context of this.contexts.values()) await context.close().catch(() => {});
		this.contexts.clear();
		const browser = this.browser;
		this.browser = null;
		if (browser) {
			if (this.mode === 'managed') {
				try { await browser.close(); } catch {}
			} else {
				browser.disconnect();
			}
		}
		if (this.idleTimer) {
			clearInterval(this.idleTimer);
			this.idleTimer = null;
		}
		for (const profile of this.ownedProcessProfile) {
			try { rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch {}
		}
		this.ownedProcessProfile.clear();
		this.closing = false;
	}

	private async sweepIdle(): Promise<void> {
		const idleSec = this.config().idleCloseSec ?? 1800;
		if (idleSec <= 0) return;
		const cutoff = Date.now() - idleSec * 1000;
		for (const [key, entry] of [...this.tabs]) {
			if (entry.persist) continue;
			if (entry.tab.lastUsedAt > cutoff) continue;
			await this.closeTabEntry(key);
		}
	}

	status(): BrowserStatus {
		return {
			connected: Boolean(this.browser?.connected),
			mode: this.mode,
			tabs: this.list(),
		};
	}
}

export const browserManager = new BrowserManager();
