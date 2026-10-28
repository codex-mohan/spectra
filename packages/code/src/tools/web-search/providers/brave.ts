import type { SsrfGuard } from '../../../security/ssrf-guard.js';
import { APP_USER_AGENT } from '../../../services/app-version.js';
import { safeFetch } from '../../network.js';
import { httpErrorMessage, parseJsonObject, truncateSnippet } from './base.js';
import { SearchProviderError, type SearchProvider, type SearchRequest, type SearchResult } from '../types.js';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const FRESHNESS: Record<string, string> = { day: 'pd', week: 'pw', month: 'pm', year: 'py' };

export function createBraveProvider(guard: SsrfGuard): SearchProvider {
	return {
		id: 'brave',
		label: 'Brave',
		isAvailable: () => Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim()),
		async search(request: SearchRequest): Promise<SearchResult[]> {
			const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
			if (!key) throw new SearchProviderError('brave', 'missing BRAVE_SEARCH_API_KEY');

			const url = new URL(ENDPOINT);
			url.searchParams.set('q', request.query);
			url.searchParams.set('count', String(request.limit));
			url.searchParams.set('safesearch', 'moderate');
			if (request.recency) url.searchParams.set('freshness', FRESHNESS[request.recency] ?? '');

			const result = await safeFetch(url.toString(), guard, {
				headers: {
					Accept: 'application/json',
					'X-Subscription-Token': key,
					'User-Agent': APP_USER_AGENT,
				},
				timeoutMs: request.timeoutMs,
				signal: request.signal,
				maxBytes: 2 * 1024 * 1024,
			});
			if (!result.ok) throw new SearchProviderError('brave', result.error);

			const { status, statusText, text } = result.response;
			if (status < 200 || status >= 300) throw httpErrorMessage('brave', status, statusText);

			const payload = parseJsonObject(text, 'brave');
			const web = payload.web as { results?: unknown[] } | undefined;
			const rows = Array.isArray(web?.results) ? web.results : [];
			return rows
				.map((row) => {
					const item = row as Record<string, unknown>;
					const title = typeof item.title === 'string' ? item.title : '';
					const urlValue = typeof item.url === 'string' ? item.url : '';
					if (!urlValue) return null;
					return {
						title: title || urlValue,
						url: urlValue,
						snippet: truncateSnippet(typeof item.description === 'string' ? item.description : ''),
						...(typeof item.age === 'string' ? { publishedAt: item.age } : {}),
					} satisfies SearchResult;
				})
				.filter((row): row is SearchResult => row !== null)
				.slice(0, request.limit);
		},
	};
}
