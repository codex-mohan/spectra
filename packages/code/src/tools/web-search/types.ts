export type SearchRecency = 'day' | 'week' | 'month' | 'year';

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
	publishedAt?: string;
}

export interface SearchRequest {
	query: string;
	limit: number;
	recency?: SearchRecency;
	timeoutMs: number;
	signal?: AbortSignal;
}

export interface SearchProvider {
	id: 'brave' | 'tavily';
	label: string;
	isAvailable(): boolean;
	search(request: SearchRequest): Promise<SearchResult[]>;
}

export class SearchProviderError extends Error {
	readonly provider: string;
	readonly status?: number;

	constructor(provider: string, message: string, status?: number) {
		super(message);
		this.name = 'SearchProviderError';
		this.provider = provider;
		this.status = status;
	}
}

export interface SearchDetails {
	provider: string;
	query: string;
	results: SearchResult[];
	notes?: string[];
	error?: string;
	elapsedMs?: number;
}

export const DEFAULT_MAX_RESULTS = 5;
export const MAX_RESULTS = 10;
export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 300_000;
