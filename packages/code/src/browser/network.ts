import { SsrfGuard } from '../security/ssrf-guard.js';

/** Exact host or `*.example.com` (which also matches the bare domain). */
export function hostMatches(hostname: string, pattern: string): boolean {
	const host = hostname.toLowerCase();
	const rule = pattern.trim().toLowerCase();
	if (!rule) return false;
	if (rule.startsWith('*.')) {
		const suffix = rule.slice(1);
		return host === rule.slice(2) || host.endsWith(suffix);
	}
	return host === rule;
}

export function isHostAllowed(hostname: string, allowedDomains: readonly string[] | undefined): boolean {
	if (!allowedDomains || allowedDomains.length === 0) return true;
	return allowedDomains.some((pattern) => hostMatches(hostname, pattern));
}

export interface RequestGuardConfig {
	allowedDomains?: readonly string[];
	ssrf?: SsrfGuard;
}

/** Decide whether a request URL may proceed. Explicit allowlist entries win over SSRF. */
export function checkRequestUrl(rawUrl: string, config: RequestGuardConfig): { ok: true } | { ok: false; reason: string } {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return { ok: false, reason: `Invalid URL: ${rawUrl}` };
	}
	if (url.protocol === 'data:' || url.protocol === 'blob:' || url.protocol === 'about:') return { ok: true };
	if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'ws:' && url.protocol !== 'wss:') {
		return { ok: false, reason: `Blocked protocol: ${url.protocol}` };
	}
	if (!isHostAllowed(url.hostname, config.allowedDomains)) {
		return { ok: false, reason: `Host not allowed: ${url.hostname}` };
	}
	if (config.ssrf && config.allowedDomains && config.allowedDomains.length > 0) {
		// An explicit allowlist entry is the user's authorization for this host.
		if (config.allowedDomains.some((pattern) => hostMatches(url.hostname, pattern))) return { ok: true };
	}
	if (config.ssrf) {
		const result = config.ssrf.check(rawUrl);
		if (!result.ok) return { ok: false, reason: result.reason };
	}
	return { ok: true };
}
