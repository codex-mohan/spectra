import type { SsrfGuard } from '../../../security/ssrf-guard.js';
import { APP_USER_AGENT } from '../../../services/app-version.js';
import { safeFetch } from '../../network.js';
import { httpErrorMessage, parseJsonObject, truncateSnippet } from './base.js';
import { SearchProviderError, type SearchProvider, type SearchRequest, type SearchResult } from '../types.js';

const ENDPOINT = 'https://api.tavily.com/search';
const DAYS: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };

export function createTavilyProvider(guard: SsrfGuard): SearchProvider {
	return {
		id: 'tavily',
		label: 'Tavily',
		isAvailable: () => Boolean(process.env.TAVILY_API_KEY?.trim()),
		async search(request: SearchRequest): Promise<SearchResult[]> {
			const key = process.env.TAVILY_API_KEY?.trim();
			if (!key) throw new SearchProviderError('tavily', 'missing TAVILY_API_KEY');

			const body: Record<string, unknown> = {
				api_key: key,
				query: request.query,
				max_results: request.limit,
				search_depth: 'basic',
				include_answer: false,
			};
			if (request.recency) body.days = DAYS[request.recency] ?? 7;

			const result = await safeFetch(ENDPOINT, guard, {
				method: 'POST',
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'User-Agent': APP_USER_AGENT,
				},
				body: JSON.stringify(body),
				timeoutMs: request.timeoutMs,
				signal: request.signal,
				maxBytes: 2 * 1024 * 1024,
			});
			if (!result.ok) throw new SearchProviderError('tavily', result.error);

			const { status, statusText, text } = result.response;
			if (status < 200 || status >= 300) throw httpErrorMessage('tavily', status, statusText);

			const payload = parseJsonObject(text, 'tavily');
			const rows = Array.isArray(payload.results) ? payload.results : [];
			return rows
				.map((row) => {
					const item = row as Record<string, unknown>;
					const url = typeof item.url === 'string' ? item.url : '';
					if (!url) return null;
					return {
						title: typeof item.title === 'string' && item.title ? item.title : url,
						url,
						snippet: truncateSnippet(typeof item.content === 'string' ? item.content : ''),
						...(typeof item.published_date === 'string' ? { publishedAt: item.published_date } : {}),
					} satisfies SearchResult;
				})
				.filter((row): row is SearchResult => row !== null)
				.slice(0, request.limit);
		},
	};
}
