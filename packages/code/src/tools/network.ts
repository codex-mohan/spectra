import type { SsrfGuard } from '../security/ssrf-guard.js';

const MAX_REDIRECTS = 5;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

export interface SafeFetchOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	maxBytes?: number;
}

export interface SafeFetchResponse {
	url: string;
	status: number;
	statusText: string;
	contentType: string;
	text: string;
	truncated: boolean;
}

export type SafeFetchResult =
	| { ok: true; response: SafeFetchResponse }
	| { ok: false; error: string };

async function readCapped(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
	if (!response.body) {
		const text = await response.text();
		return text.length > maxBytes
			? { text: text.slice(0, maxBytes), truncated: true }
			: { text, truncated: false };
	}

	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let received = 0;
	let text = '';
	let truncated = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			received += value.byteLength;
			if (received > maxBytes) {
				const over = received - maxBytes;
				text += decoder.decode(value.subarray(0, Math.max(0, value.byteLength - over)), { stream: true });
				truncated = true;
				await reader.cancel().catch(() => {});
				break;
			}
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		text += decoder.decode();
	}
	return { text, truncated };
}

/**
 * The only outbound HTTP path for built-in tools. Checks SSRF on the initial
 * URL and on every redirect target, caps the body, and enforces a timeout.
 */
export async function safeFetch(
	rawUrl: string,
	guard: SsrfGuard,
	options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
	const timeoutMs = options.timeoutMs ?? 15_000;
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
	let url = rawUrl;

	for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			return { ok: false, error: `Invalid URL: ${rawUrl}` };
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return { ok: false, error: `Unsupported protocol: ${parsed.protocol}` };
		}
		const check = guard.check(url);
		if (!check.ok) return { ok: false, error: `SSRF guard: ${check.reason}` };

		let response: Response;
		try {
			response = await fetch(url, {
				method: options.method ?? 'GET',
				headers: options.headers,
				body: options.body,
				redirect: 'manual',
				signal,
			});
		} catch (err: unknown) {
			const error = err as { name?: string; message?: string };
			if (options.signal?.aborted) return { ok: false, error: 'Request aborted' };
			if (error.name === 'TimeoutError') return { ok: false, error: `Request timed out after ${Math.round(timeoutMs / 1000)}s.` };
			return { ok: false, error: `Fetch failed: ${error.message || 'unknown error'}` };
		}

		if (response.status >= 300 && response.status < 400) {
			const location = response.headers.get('location');
			if (!location) return { ok: false, error: `Redirect ${response.status} without a Location header` };
			if (hop === MAX_REDIRECTS) return { ok: false, error: 'Too many redirects' };
			url = new URL(location, url).toString();
			continue;
		}

		const { text, truncated } = await readCapped(response, maxBytes);
		return {
			ok: true,
			response: {
				url,
				status: response.status,
				statusText: response.statusText,
				contentType: response.headers.get('content-type') || '',
				text,
				truncated,
			},
		};
	}

	return { ok: false, error: 'Too many redirects' };
}
