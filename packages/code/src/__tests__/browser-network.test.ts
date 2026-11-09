import { describe, expect, it } from 'vitest';
import { checkRequestUrl, hostMatches, isHostAllowed } from '../browser/network.js';
import { SsrfGuard } from '../security/ssrf-guard.js';

describe('browser network policy', () => {
	it('matches exact and wildcard hosts', () => {
		expect(hostMatches('example.com', 'example.com')).toBe(true);
		expect(hostMatches('api.example.com', '*.example.com')).toBe(true);
		expect(hostMatches('example.com', '*.example.com')).toBe(true);
		expect(hostMatches('evil-example.com', '*.example.com')).toBe(false);
		expect(hostMatches('example.com.evil.test', '*.example.com')).toBe(false);
	});

	it('allows everything when the list is empty', () => {
		expect(isHostAllowed('anything.test', [])).toBe(true);
		expect(isHostAllowed('anything.test', undefined)).toBe(true);
	});

	it('blocks non-allowlisted hosts and unsafe protocols', () => {
		expect(checkRequestUrl('https://good.test/page', { allowedDomains: ['good.test'] })).toEqual({ ok: true });
		expect(checkRequestUrl('https://bad.test/page', { allowedDomains: ['good.test'] })).toMatchObject({ ok: false });
		expect(checkRequestUrl('file:///etc/passwd', {})).toMatchObject({ ok: false });
		expect(checkRequestUrl('data:text/plain,hello', {})).toEqual({ ok: true });
	});

	it('applies SSRF but lets an explicit allowlist entry through', () => {
		const ssrf = new SsrfGuard();
		expect(checkRequestUrl('http://127.0.0.1:3000', { ssrf })).toMatchObject({ ok: false });
		expect(checkRequestUrl('http://127.0.0.1:3000', { ssrf, allowedDomains: ['127.0.0.1'] })).toEqual({ ok: true });
	});
});
