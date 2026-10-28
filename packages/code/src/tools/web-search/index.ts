import { z } from 'zod';
import type { SpectraTool } from '../types.js';
import { errorResult, textResult } from '../utils.js';
import { SsrfGuard } from '../../security/ssrf-guard.js';
import { loadConfig } from '../../services/config.js';
import { clampInt } from './providers/base.js';
import { createBraveProvider } from './providers/brave.js';
import { createTavilyProvider } from './providers/tavily.js';
import { applyConstraints, parseQuery } from './query.js';
import { formatSearchResults } from './format.js';
import {
	DEFAULT_MAX_RESULTS,
	DEFAULT_TIMEOUT_MS,
	MAX_RESULTS,
	MAX_TIMEOUT_MS,
	type SearchDetails,
	type SearchProvider,
} from './types.js';

const CONFIG_HINT = 'Set BRAVE_SEARCH_API_KEY or TAVILY_API_KEY, or configure tools.webSearch.providers in spectra.json.';

export function createWebSearchTool(guard: SsrfGuard = new SsrfGuard()): SpectraTool {
	return {
		name: 'web_search',
		capabilities: { reads: false, writes: false },
		description: `Search the web and return ranked sources with titles, URLs, and snippets.
Use for current information, release notes, documentation, or anything that may have changed.
Supports quoted phrases, -term exclusions, site:, filetype:, and recency.
Requires a configured provider: BRAVE_SEARCH_API_KEY or TAVILY_API_KEY.`,
		displayName: (args: { query: string }) => `"${args.query}"`,
		parameters: z.object({
			query: z.string().describe('Search query. Supports quoted phrases, site:, filetype:, -term, and OR.'),
			recency: z.enum(['day', 'week', 'month', 'year']).optional().describe('Restrict results to a recent window'),
			limit: z.number().optional().describe('Maximum results (1-10, default from config or 5)'),
		}),
		execute: async (args, ctx) => {
			const config = loadConfig().tools?.webSearch ?? {};
			const providerIds = config.providers?.length ? config.providers : (['brave', 'tavily'] as const);
			const limit = clampInt(args.limit ?? config.maxResults, DEFAULT_MAX_RESULTS, 1, MAX_RESULTS);
			const timeoutMs = clampInt(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, MAX_TIMEOUT_MS);
			const parsed = parseQuery(args.query);
			const searchQuery = parsed.text || args.query;

			const providers: SearchProvider[] = providerIds.map((id) =>
				id === 'tavily' ? createTavilyProvider(guard) : createBraveProvider(guard),
			);
			const available = providers.filter((provider) => provider.isAvailable());
			if (available.length === 0) {
				return errorResult(`No web search provider configured. ${CONFIG_HINT}`);
			}

			const failures: string[] = [];
			let sawEmpty = false;

			for (const provider of available) {
				const started = Date.now();
				try {
					const raw = await provider.search({
						query: searchQuery,
						limit,
						recency: args.recency,
						timeoutMs,
						signal: ctx.signal,
					});
					const { results, notes } = applyConstraints(raw, parsed);
					if (results.length === 0) {
						sawEmpty = true;
						continue;
					}
					const details: SearchDetails = {
						provider: provider.id,
						query: args.query,
						results,
						...(notes.length > 0 ? { notes } : {}),
						elapsedMs: Date.now() - started,
					};
					return textResult(formatSearchResults(details), details);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					if (ctx.signal?.aborted) return errorResult('Search aborted');
					failures.push(`${provider.id}: ${message}`);
				}
			}

			if (sawEmpty && failures.length === 0) {
				const details: SearchDetails = { provider: 'none', query: args.query, results: [] };
				return textResult(formatSearchResults(details), details);
			}

			const message = failures.length > 1
				? `All web search providers failed: ${failures.join('; ')}`
				: failures[0] ?? 'No web search provider returned results.';
			return {
				content: [{ type: 'text' as const, text: message }],
				isError: true,
				details: { provider: 'none', query: args.query, results: [], error: message } satisfies SearchDetails,
			};
		},
	};
}
