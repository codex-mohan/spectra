import { SearchProviderError } from '../types.js';

export function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
	const parsed = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : fallback;
	return Math.min(max, Math.max(min, parsed));
}

export function truncateSnippet(text: string | undefined, max = 240): string {
	const clean = (text ?? '').replace(/\s+/g, ' ').trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function httpErrorMessage(provider: string, status: number, statusText: string): SearchProviderError {
	if (status === 401 || status === 403) {
		return new SearchProviderError(provider, 'authorization failed; check the API key', status);
	}
	if (status === 429) {
		return new SearchProviderError(provider, 'rate limited; try again later', status);
	}
	if (status >= 500) {
		return new SearchProviderError(provider, `provider error (HTTP ${status})`, status);
	}
	return new SearchProviderError(provider, `HTTP ${status}${statusText ? ` ${statusText}` : ''}`, status);
}

export function parseJsonObject(text: string, provider: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// fall through
	}
	throw new SearchProviderError(provider, 'invalid JSON response');
}
