import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { SpectraTool, ToolContext } from './types.js';
import { errorResult, textResult } from './utils.js';
import { browserManager, type BrowserManager, type OpenTabOptions } from '../browser/manager.js';
import type { BrowserTab } from '../browser/tab.js';
import type { SecurityManager } from '../security/index.js';
import { PermissionDeniedError } from '../security/index.js';
import { checkRequestUrl } from '../browser/network.js';
import { SsrfGuard } from '../security/ssrf-guard.js';
import { loadConfig } from '../services/config.js';
import { getGlobalConfigDir } from '../utils/paths.js';

const MAX_MODEL_IMAGE_BYTES = 150 * 1024;
const MAX_MODEL_IMAGE_DIMENSION = 1024;

interface BrowserToolDeps {
	manager?: BrowserManager;
	security?: SecurityManager;
}

function sessionOf(context: ToolContext): string {
	if (!context.sessionId) throw new Error('Browser tools require a session id');
	return context.sessionId;
}

function tabFor(manager: BrowserManager, sessionId: string, name: string | undefined): BrowserTab {
	return manager.get(sessionId, name?.trim() || 'main');
}

function formatElements(url: string, title: string, elements: Array<{ id: string; role: string; name: string; tag: string; value?: string }>): string {
	if (elements.length === 0) return `No interactive elements found on ${url} (${title}).`;
	return [
		`URL: ${url}`,
		`Title: ${title}`,
		'',
		...elements.map((element) => {
			const value = element.value !== undefined && element.value !== '' ? ` value="${element.value}"` : '';
			return `${element.id}  ${element.role}  ${element.name || '(unnamed)'}${value}`;
		}),
	].join('\n');
}

async function requireBrowserPermission(
	security: SecurityManager | undefined,
	url: string | undefined,
	action: string,
): Promise<void> {
	if (!security || !url) return;
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		throw new Error(`Invalid URL: ${url}`);
	}
	await security.checkPermission('browser', [hostname], 'browser', `${action} ${hostname}`, { tier: 'network' });
}

function screenshotPath(sessionId: string, extension: string): string {
	const configured = loadConfig().browser?.screenshotDir?.trim();
	const directory = configured || join(getGlobalConfigDir(), 'artifacts', sessionId);
	mkdirSync(directory, { recursive: true });
	return join(directory, `${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`);
}

function imageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
	if (bytes.length < 24) return undefined;
	// PNG signature + IHDR dimensions.
	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
		const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}
	return undefined;
}

async function captureModelImage(tab: BrowserTab): Promise<{ bytes: Uint8Array; mime: string; restored?: { width: number; height: number } }> {
	let bytes = await tab.screenshot({ type: 'png' });
	let mime = 'image/png';
	const dimensions = imageDimensions(bytes);
	const tooLarge = bytes.length > MAX_MODEL_IMAGE_BYTES
		|| (dimensions && (dimensions.width > MAX_MODEL_IMAGE_DIMENSION || dimensions.height > MAX_MODEL_IMAGE_DIMENSION));
	if (!tooLarge) return { bytes, mime };

	const restored = await tab.resizeForModel(MAX_MODEL_IMAGE_DIMENSION, MAX_MODEL_IMAGE_DIMENSION);
	bytes = await tab.screenshot({ type: 'jpeg', quality: 65 });
	mime = 'image/jpeg';
	if (bytes.length > MAX_MODEL_IMAGE_BYTES) {
		bytes = await tab.screenshot({ type: 'jpeg', quality: 40 });
	}
	return { bytes, mime, restored };
}

export function createBrowserTools(deps: BrowserToolDeps = {}): SpectraTool[] {
	const manager = deps.manager ?? browserManager;
	const security = deps.security;

	const openTool: SpectraTool = {
		name: 'browser_open',
		capabilities: { reads: true, writes: false },
		streaming: { arguments: true },
		description: `Open or reuse a managed Chromium tab.
Returns the tab name, URL, title, and whether an observe is needed.`,
		displayName: (args: { url?: string; name?: string }) => `browser open ${args.name ?? 'main'}${args.url ? ` · ${args.url}` : ''}`,
		parameters: z.object({
			name: z.string().optional().describe('Tab name, default main'),
			url: z.string().optional().describe('URL to open'),
			viewport: z.object({ width: z.number(), height: z.number(), scale: z.number().optional() }).optional(),
			allowed_domains: z.array(z.string()).optional().describe('Exact hosts or *.example.com allowlist'),
			headed: z.boolean().optional().describe('Show a browser window'),
			timeout: z.number().optional().describe('Navigation timeout in milliseconds'),
			persist: z.boolean().optional().describe('Keep this tab open across idle close'),
		}),
		execute: async (args, ctx) => {
			try {
				const sessionId = sessionOf(ctx);
				await requireBrowserPermission(security, args.url, 'open');
				if (args.url) {
					const check = checkRequestUrl(args.url, {
						allowedDomains: args.allowed_domains ?? loadConfig().browser?.allowedDomains,
						ssrf: new SsrfGuard(loadConfig().security?.ssrf),
					});
					if (!check.ok) return errorResult(check.reason);
				}
				const options: OpenTabOptions = {
					name: args.name,
					url: args.url,
					viewport: args.viewport as OpenTabOptions['viewport'],
					allowedDomains: args.allowed_domains,
					headed: args.headed,
					timeout: args.timeout,
					persist: args.persist,
				};
				const tab = await manager.open(sessionId, options);
				return textResult(
					[`Opened browser tab "${tab.name}".`, `URL: ${tab.url}`, `Title: ${await tab.title()}`, 'Call browser_observe before clicking or typing.'].join('\n'),
					{ tab: tab.name, url: tab.url, title: await tab.title() },
				);
			} catch (error) {
				return errorResult(error instanceof PermissionDeniedError ? `Permission denied: ${error.message}` : error instanceof Error ? error.message : String(error));
			}
		},
	};

	const observeTool: SpectraTool = {
		name: 'browser_observe',
		capabilities: { reads: true, writes: false },
		streaming: { arguments: true },
		description: `List interactive elements on the current page as numeric refs (e1, e2...).
Refs are invalidated by navigation; re-observe before acting after a page change.`,
		displayName: (args: { tab?: string }) => `browser observe ${args.tab ?? 'main'}`,
		parameters: z.object({
			tab: z.string().optional().describe('Tab name, default main'),
			includeAll: z.boolean().optional().describe('Include non-interactive accessibility nodes'),
			viewportOnly: z.boolean().optional().describe('Only elements in the viewport (default true)'),
			selector: z.string().optional().describe('Restrict observation to a CSS selector'),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				const observed = await tab.observe({ includeAll: args.includeAll, viewportOnly: args.viewportOnly, selector: args.selector });
				return textResult(formatElements(observed.url, observed.title, observed.elements), {
					tab: tab.name,
					url: observed.url,
					title: observed.title,
					elements: observed.elements,
				});
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const clickTool: SpectraTool = {
		name: 'browser_click',
		capabilities: { reads: true, writes: true },
		streaming: { arguments: true },
		description: 'Click an observed ref or CSS selector. A stale ref fails; re-observe first.',
		displayName: (args: { ref?: string; selector?: string }) => `browser click ${args.ref ?? args.selector ?? ''}`,
		parameters: z.object({
			tab: z.string().optional(),
			ref: z.string().optional().describe('Observed ref such as e3'),
			selector: z.string().optional().describe('CSS selector when no ref is used'),
			button: z.enum(['left', 'right', 'middle']).optional(),
			count: z.number().optional(),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				await tab.click({ ref: args.ref, selector: args.selector, button: args.button, count: args.count });
				return textResult(`Clicked ${args.ref ?? args.selector} on "${tab.name}".`, { tab: tab.name, url: tab.url });
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const typeTool: SpectraTool = {
		name: 'browser_type',
		capabilities: { reads: true, writes: true },
		streaming: { arguments: true },
		description: 'Type into an observed ref or selector. Optionally clear the field or press Enter.',
		displayName: (args: { ref?: string; selector?: string }) => `browser type ${args.ref ?? args.selector ?? ''}`,
		parameters: z.object({
			tab: z.string().optional(),
			ref: z.string().optional(),
			selector: z.string().optional(),
			text: z.string().describe('Text to type'),
			clear: z.boolean().optional(),
			submit: z.boolean().optional(),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				await tab.type({ ref: args.ref, selector: args.selector, text: args.text, clear: args.clear, submit: args.submit });
				return textResult(`Typed into ${args.ref ?? args.selector} on "${tab.name}".`, { tab: tab.name, url: tab.url });
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const extractTool: SpectraTool = {
		name: 'browser_extract',
		capabilities: { reads: true, writes: false },
		streaming: { arguments: true },
		description: 'Extract text, HTML, a value, or an attribute from the current page.',
		displayName: (args: { format?: string }) => `browser extract ${args.format ?? 'text'}`,
		parameters: z.object({
			tab: z.string().optional(),
			selector: z.string().optional().describe('CSS selector, default body'),
			format: z.enum(['text', 'html', 'value', 'attr']).optional(),
			attr: z.string().optional(),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				const text = await tab.extract({ selector: args.selector, format: args.format, attr: args.attr });
				return textResult(text, { tab: tab.name, url: tab.url, bytes: Buffer.byteLength(text) });
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const waitTool: SpectraTool = {
		name: 'browser_wait',
		capabilities: { reads: true, writes: false },
		streaming: { arguments: true },
		description: 'Wait for a selector, visible text, or URL substring.',
		displayName: (args: { selector?: string; text?: string; url?: string }) => `browser wait ${args.selector ?? args.text ?? args.url ?? ''}`,
		parameters: z.object({
			tab: z.string().optional(),
			selector: z.string().optional(),
			text: z.string().optional(),
			url: z.string().optional(),
			timeout: z.number().optional(),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				await tab.wait({ selector: args.selector, text: args.text, url: args.url, timeout: args.timeout });
				return textResult(`Wait satisfied on "${tab.name}".`, { tab: tab.name, url: tab.url });
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const screenshotTool: SpectraTool = {
		name: 'browser_screenshot',
		capabilities: { reads: true, writes: false },
		streaming: { arguments: true },
		description: 'Capture the page as an image. The full-resolution PNG is saved to the screenshot directory and a capped image is returned to the model.',
		displayName: () => 'browser screenshot',
		parameters: z.object({
			tab: z.string().optional(),
			full_page: z.boolean().optional(),
			selector: z.string().optional().describe('Optional CSS selector to capture'),
		}),
		execute: async (args, ctx) => {
			try {
				const tab = tabFor(manager, sessionOf(ctx), args.tab);
				const full = await tab.screenshot({ fullPage: args.full_page, type: 'png', selector: args.selector });
				const path = screenshotPath(sessionOf(ctx), 'png');
				writeFileSync(path, full);
				let model = await captureModelImage(tab);
				if (model.restored) {
					await tab.restoreViewport(model.restored);
					model = { bytes: model.bytes, mime: model.mime };
				}
				const base64 = Buffer.from(model.bytes).toString('base64');
				return {
					content: [
						{ type: 'text' as const, text: `Screenshot saved to ${path} (${full.length} bytes).` },
						{ type: 'image' as const, data: base64, mimeType: model.mime },
					],
					details: { tab: tab.name, url: tab.url, path, bytes: full.length, modelBytes: model.bytes.length },
				};
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	const closeTool: SpectraTool = {
		name: 'browser_close',
		capabilities: { reads: false, writes: false },
		streaming: { arguments: true },
		description: 'Close one browser tab, all tabs in this session, or the whole browser.',
		displayName: (args: { tab?: string; all?: boolean }) => `browser close ${args.all ? 'session' : args.tab ?? 'main'}`,
		parameters: z.object({
			tab: z.string().optional(),
			all: z.boolean().optional().describe('Close every tab owned by this session'),
		}),
		execute: async (args, ctx) => {
			try {
				const sessionId = sessionOf(ctx);
				if (args.all) {
					await manager.closeSession(sessionId);
					return textResult('Closed all browser tabs for this session.');
				}
				const closed = await manager.closeTab(sessionId, args.tab?.trim() || 'main');
				return textResult(closed ? `Closed browser tab "${args.tab ?? 'main'}".` : 'No matching browser tab.');
			} catch (error) {
				return errorResult(error instanceof Error ? error.message : String(error));
			}
		},
	};

	return [openTool, observeTool, clickTool, typeTool, extractTool, waitTool, screenshotTool, closeTool];
}
