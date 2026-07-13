import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { write as writeCredential } from '../services/auth-store.js';
import {
	buildProviderUsageReport,
	buildUsageReports,
	fetchUsageReports,
	recordUsageCost,
	readUsageEntries,
} from '../services/usage-store.js';

describe('usage store', () => {
	let tmpDir: string;
	let previousDataHome: string | undefined;
	let previousFetch: typeof fetch;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-usage-test-'));
		previousDataHome = process.env.SPECTRA_HOME;
		previousFetch = globalThis.fetch;
		process.env.SPECTRA_HOME = tmpDir;
	});

	afterEach(() => {
		globalThis.fetch = previousFetch;
		if (previousDataHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = previousDataHome;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it('records usage cost entries', () => {
		recordUsageCost({
			recordedAt: 1,
			provider: 'opencode-go',
			model: 'deepseek-v4',
			sessionId: 's1',
			inputTokens: 100,
			outputTokens: 50,
			costUsd: 0.25,
		}, tmpDir);

		expect(readUsageEntries(tmpDir)).toEqual([
			{
				recordedAt: 1,
				provider: 'opencode-go',
				model: 'deepseek-v4',
				sessionId: 's1',
				inputTokens: 100,
				outputTokens: 50,
				costUsd: 0.25,
			},
		]);
	});

	it('builds OpenCode Go usage windows from observed costs', () => {
		const now = 40 * 24 * 60 * 60 * 1000;
		const hour = 60 * 60 * 1000;
		const day = 24 * hour;
		const report = buildProviderUsageReport('opencode-go', [
			{ recordedAt: now - hour, provider: 'opencode-go', model: 'a', inputTokens: 1, outputTokens: 1, costUsd: 3 },
			{ recordedAt: now - 6 * hour, provider: 'opencode-go', model: 'a', inputTokens: 1, outputTokens: 1, costUsd: 5 },
			{ recordedAt: now - 10 * day, provider: 'opencode-go', model: 'a', inputTokens: 1, outputTokens: 1, costUsd: 7 },
		], now);

		expect(report.windows.map((window) => ({ id: window.id, used: window.used, remaining: window.remaining }))).toEqual([
			{ id: '5h', used: 3, remaining: 9 },
			{ id: '7d', used: 8, remaining: 22 },
			{ id: '30d', used: 15, remaining: 45 },
		]);
	});

	it('includes connected plans with no local usage yet', () => {
		const reports = buildUsageReports(['opencode-go'], [], 1);

		expect(reports).toHaveLength(1);
		expect(reports[0].provider).toBe('opencode-go');
		expect(reports[0].windows[0].used).toBe(0);
	});

	it('fetches Kimi live usage from the /usages endpoint', async () => {
		writeCredential('kimi-code', {
			type: 'oauth',
			access: 'kimi-access',
			refresh: 'kimi-refresh',
			expires: 2_000_000,
			accountId: 'acct-kimi',
		});
		const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			expect(String(url)).toBe('https://api.kimi.com/coding/v1/usages');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer kimi-access');
			return new Response(JSON.stringify({
				limits: [
					{
						name: 'Daily tokens',
						detail: { used: 25, limit: 100 },
						window: { duration: 1, timeUnit: 'DAY', reset_in: 3600 },
					},
				],
			}), { status: 200 });
		}) as typeof fetch;

		const reports = await fetchUsageReports({ providers: ['kimi-code'], nowMs: 1_000_000, fetchImpl: fetchMock, dataDir: tmpDir });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(reports[0].source).toBe('live');
		expect(reports[0].windows[0]).toMatchObject({ label: 'Daily tokens', used: 25, limit: 100, unit: 'tokens', accountLabel: 'acct-kimi' });
		expect(reports[0].windows[0].resetsAt).toBe(4_600_000);
	});

	it('refreshes expired Kimi OAuth before fetching usage', async () => {
		writeCredential('kimi-code', {
			type: 'oauth',
			access: 'old-access',
			refresh: 'refresh-token',
			expires: 1,
		});
		const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).endsWith('/api/oauth/token')) {
				return new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), { status: 200 });
			}
			expect(String(url)).toBe('https://api.kimi.com/coding/v1/usages');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer new-access');
			return new Response(JSON.stringify({ usage: { used: 1, limit: 10 } }), { status: 200 });
		}) as typeof fetch;
		globalThis.fetch = fetchMock;

		const reports = await fetchUsageReports({ providers: ['kimi-code'], nowMs: 1_000_000, dataDir: tmpDir });

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(reports[0].source).toBe('live');
		expect(reports[0].windows[0]).toMatchObject({ used: 1, limit: 10 });
	});

	it('fetches ZAI live token and request quotas', async () => {
		writeCredential('zai-coding-plan', { type: 'api', key: 'zai-key' });
		const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			expect(String(url)).toBe('https://api.z.ai/api/monitor/usage/quota/limit');
			expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer zai-key');
			return new Response(JSON.stringify({
				success: true,
				data: {
					limits: [
						{ type: 'TOKENS_LIMIT', currentValue: 200, usage: 1000, remaining: 800, percentage: 20, unit: 5, number: 1 },
						{ type: 'TIME_LIMIT', currentValue: 2, usage: 10, remaining: 8, percentage: 20, unit: 3, number: 5 },
					],
				},
			}), { status: 200 });
		}) as typeof fetch;

		const reports = await fetchUsageReports({ providers: ['zai-coding-plan'], nowMs: 1, fetchImpl: fetchMock, dataDir: tmpDir });

		expect(reports[0].source).toBe('live');
		expect(reports[0].windows.map((window) => ({ label: window.label, unit: window.unit, used: window.used, remaining: window.remaining }))).toEqual([
			{ label: 'ZAI Monthly Token Quota', unit: 'tokens', used: 200, remaining: 800 },
			{ label: 'ZAI Request Quota', unit: 'requests', used: 2, remaining: 8 },
		]);
	});

	it('uses last-good live cache when a provider refresh fails', async () => {
		writeCredential('zai-coding-plan', { type: 'api', key: 'zai-key' });
		const okFetch = vi.fn(async () => new Response(JSON.stringify({
			success: true,
			data: { limits: [{ type: 'TOKENS_LIMIT', currentValue: 1, usage: 10, remaining: 9, unit: 5, number: 1 }] },
		}), { status: 200 })) as typeof fetch;
		const first = await fetchUsageReports({ providers: ['zai-coding-plan'], nowMs: 1_000_000, fetchImpl: okFetch, dataDir: tmpDir });
		expect(first[0].source).toBe('live');

		const failingFetch = vi.fn(async () => new Response('nope', { status: 500 })) as typeof fetch;
		const second = await fetchUsageReports({ providers: ['zai-coding-plan'], nowMs: 1_000_000 + 10 * 60 * 1000, fetchImpl: failingFetch, dataDir: tmpDir });

		expect(second[0].source).toBe('live');
		expect(second[0].notes).toContain('Last live snapshot shown; refresh failed.');
		expect(second[0].windows[0]).toMatchObject({ used: 1, limit: 10 });
	});
});
