import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SsrfGuard } from '../security/ssrf-guard.js';
import { safeFetch } from '../tools/network.js';
import { createBraveProvider } from '../tools/web-search/providers/brave.js';
import { createTavilyProvider } from '../tools/web-search/providers/tavily.js';
import { createWebSearchTool } from '../tools/web-search/index.js';
import { applyConstraints, parseQuery } from '../tools/web-search/query.js';
import { formatSearchResults } from '../tools/web-search/format.js';
import type { SearchRequest, SearchResult } from '../tools/web-search/types.js';

const guard = new SsrfGuard();

function request(overrides: Partial<SearchRequest> = {}): SearchRequest {
	return { query: 'typescript', limit: 5, timeoutMs: 5_000, ...overrides };
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

beforeEach(() => {
	vi.unstubAllEnvs();
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('query constraints', () => {
	it('parses directives and keeps quoted phrases', () => {
		const parsed = parseQuery('site:example.com filetype:pdf -spam "exact phrase" OR other');
		expect(parsed.text).toBe('"exact phrase" OR other');
		expect(parsed.sites).toEqual(['example.com']);
		expect(parsed.filetypes).toEqual(['pdf']);
		expect(parsed.excludedTerms).toEqual(['spam']);
	});

	it('filters by site and deduplicates URLs', () => {
		const results: SearchResult[] = [
			{ title: 'a', url: 'https://example.com/a', snippet: '' },
			{ title: 'a duplicate', url: 'https://example.com/a', snippet: '' },
			{ title: 'b', url: 'https://other.com/b', snippet: '' },
		];
		const filtered = applyConstraints(results, parseQuery('site:example.com'));
		expect(filtered.results.map((result) => result.url)).toEqual(['https://example.com/a']);
		expect(filtered.notes).toEqual([]);
	});

	it('relaxes a dimension that would remove every result and explains why', () => {
		const results: SearchResult[] = [{ title: 'a', url: 'https://other.com/a', snippet: '' }];
		const filtered = applyConstraints(results, parseQuery('site:example.com'));
		expect(filtered.results).toHaveLength(1);
		expect(filtered.notes[0]).toContain('site:example.com');
	});
});

describe('providers', () => {
	it('reads Brave results and sends the key header', async () => {
		vi.stubEnv('BRAVE_SEARCH_API_KEY', 'brave-key');
		const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => jsonResponse({
			web: { results: [{ title: 'TS 5.8', url: 'https://devblogs.microsoft.com/typescript/58', description: 'Release notes', age: '2 days ago' }] },
		}));
		vi.stubGlobal('fetch', fetchMock);

		const provider = createBraveProvider(guard);
		const results = await provider.search(request({ query: 'typescript 5.8' }));

		expect(results).toEqual([
			{ title: 'TS 5.8', url: 'https://devblogs.microsoft.com/typescript/58', snippet: 'Release notes', publishedAt: '2 days ago' },
		]);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toContain('api.search.brave.com');
		expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('brave-key');
	});

	it('reads Tavily results', async () => {
		vi.stubEnv('TAVILY_API_KEY', 'tavily-key');
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
			results: [{ title: 'TS 5.8', url: 'https://devblogs.microsoft.com/typescript/58', content: 'Release notes', published_date: '2025-03-01' }],
		})));

		const provider = createTavilyProvider(guard);
		const results = await provider.search(request());
		expect(results[0]).toMatchObject({ title: 'TS 5.8', url: 'https://devblogs.microsoft.com/typescript/58' });
	});

	it('maps an authorization failure to a clear provider error', async () => {
		vi.stubEnv('BRAVE_SEARCH_API_KEY', 'bad');
		vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 401)));

		await expect(createBraveProvider(guard).search(request())).rejects.toThrow('authorization failed');
	});
});

describe('provider chain', () => {
	it('falls back to the next provider', async () => {
		vi.stubEnv('BRAVE_SEARCH_API_KEY', 'bad');
		vi.stubEnv('TAVILY_API_KEY', 'good');
		vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
			const url = String(input);
			if (url.includes('brave')) return jsonResponse({}, 401);
			return jsonResponse({
				results: [{ title: 'Tavily result', url: 'https://example.com/t', content: 'Found it' }],
			});
		}));

		const tool = createWebSearchTool(guard);
		const result = await tool.execute({ query: 'typescript' }, { toolCallId: 'call-1' });
		const part = result.content[0];
		const text = part && part.type === 'text' ? part.text : '';

		expect(result.isError).toBeUndefined();
		expect(text).toContain('Tavily result');
		const details = result.details;
		expect(details && typeof details === 'object' && 'provider' in details ? details.provider : undefined).toBe('tavily');
	});

	it('names both keys when no provider is configured', async () => {
		const tool = createWebSearchTool(guard);
		const result = await tool.execute({ query: 'typescript' }, { toolCallId: 'call-1' });
		const part = result.content[0];
		const text = part && part.type === 'text' ? part.text : '';

		expect(result.isError).toBe(true);
		expect(text).toContain('BRAVE_SEARCH_API_KEY');
		expect(text).toContain('TAVILY_API_KEY');
	});
});

describe('safe fetch redirects', () => {
	it('re-checks SSRF on a redirect target and never requests it', async () => {
		const fetchMock = vi.fn(async () => new Response(null, {
			status: 302,
			headers: { location: 'http://127.0.0.1/secret' },
		}));
		vi.stubGlobal('fetch', fetchMock);

		const result = await safeFetch('https://example.com/start', guard);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('SSRF');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caps an oversized response body', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(2048), {
			status: 200,
			headers: { 'content-type': 'text/plain' },
		})));

		const result = await safeFetch('https://example.com/big', guard, { maxBytes: 512 });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.response.truncated).toBe(true);
			expect(result.response.text.length).toBeLessThanOrEqual(512);
		}
	});
});

describe('formatting', () => {
	it('numbers sources and prefixes relaxation notes', () => {
		const text = formatSearchResults({
			provider: 'brave',
			query: 'q',
			results: [{ title: 'Title', url: 'https://example.com', snippet: 'Snippet', publishedAt: '2 days ago' }],
			notes: ['no results matched site:x; filter relaxed'],
		});
		expect(text.split('\n')[0]).toBe('Note: no results matched site:x; filter relaxed');
		expect(text).toContain('1. Title (2 days ago)');
		expect(text).toContain('https://example.com');
	});
});
