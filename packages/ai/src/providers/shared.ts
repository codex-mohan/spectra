import type { ProviderErrorDetails, ProviderErrorKind } from '../types.js';

export function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

export function parseStreamingJson(json: string): Record<string, unknown> {
	try {
		return JSON.parse(json);
	} catch {
		return {};
	}
}



const MAX_RESPONSE_BODY_CHARS = 32_768;
const SAFE_RESPONSE_HEADERS: Record<string, true> = {
	'content-type': true, 'retry-after': true, 'request-id': true, 'x-request-id': true, 'x-ratelimit-limit-requests': true,
	'x-ratelimit-remaining-requests': true, 'x-ratelimit-reset-requests': true, 'x-ratelimit-limit-tokens': true,
	'x-ratelimit-remaining-tokens': true, 'x-ratelimit-reset-tokens': true, 'openai-processing-ms': true, 'cf-ray': true,
};
const SECRET_PATTERN = /\b(?:bearer\s+|basic\s+|api[_-]?key\s*[=:]\s*|authorization\s*[=:]\s*|cookie\s*[=:]\s*)[A-Za-z0-9._~+\/=:-]+/gi;

/** Converts SDK/provider failures to a bounded record suitable for local persistence. */
export function normalizeProviderError(error: unknown, options: { aborted?: boolean } = {}): ProviderErrorDetails {
	const value = asRecord(error);
	const statusCode = numberValue(value.statusCode) ?? numberValue(value.status) ?? numberValue(asRecord(value.response).status);
	const responseHeaders = sanitizeHeaders(value.headers ?? asRecord(value.response).headers);
	const responseBody = readResponseBody(value);
	const message = sanitizeDiagnostic(error instanceof Error ? error.message : stringValue(value.message) ?? String(error));
	const providerCode = stringValue(value.code) ?? stringValue(asRecord(value.error).code);
	const retryAfterMs = parseRetryAfter(responseHeaders?.['retry-after']);
	const kind = classifyProviderError({ message, statusCode, providerCode, aborted: options.aborted === true });
	const retryable = kind !== 'aborted' && kind !== 'auth' && kind !== 'configuration' && kind !== 'context_overflow'
		&& (statusCode === 429 || (statusCode !== undefined && statusCode >= 500) || kind === 'network' || kind === 'timeout');
	const details: ProviderErrorDetails = { kind, message, retryable, statusCode, providerCode, retryAfterMs };
	if (responseHeaders && Object.keys(responseHeaders).length > 0) details.responseHeaders = responseHeaders;
	if (responseBody) {
		details.responseBody = responseBody.content;
		details.responseBodyTruncated = responseBody.truncated || undefined;
	}
	return details;
}

function asRecord(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function sanitizeHeaders(value: unknown): Record<string, string> | undefined {
	const entries = value instanceof Headers ? [...value.entries()] : Object.entries(asRecord(value));
	const headers: Record<string, string> = {};
	for (const [name, headerValue] of entries) {
		const normalized = name.toLowerCase();
		if (!SAFE_RESPONSE_HEADERS[normalized] || typeof headerValue !== 'string') continue;
		headers[normalized] = sanitizeDiagnostic(headerValue);
	}
	return Object.keys(headers).length > 0 ? headers : undefined;
}

function readResponseBody(value: Record<string, unknown>): { content: string; truncated: boolean } | undefined {
	const response = asRecord(value.response);
	const rawMetadata = asRecord(asRecord(value.error).metadata).raw;
	const candidate = stringValue(value.responseBody) ?? stringValue(value.body) ?? stringValue(response.body)
		?? stringValue(response.data) ?? stringValue(rawMetadata);
	if (!candidate) return undefined;
	const sanitized = sanitizeDiagnostic(candidate);
	return {
		content: sanitized.slice(0, MAX_RESPONSE_BODY_CHARS),
		truncated: sanitized.length > MAX_RESPONSE_BODY_CHARS,
	};
}

function sanitizeDiagnostic(value: string): string {
	return value.replace(SECRET_PATTERN, '[redacted]').trim();
}

function parseRetryAfter(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const seconds = Number(value);
	return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1_000) : undefined;
}

function classifyProviderError(input: { message: string; statusCode?: number; providerCode?: string; aborted: boolean }): ProviderErrorKind {
	if (input.aborted) return 'aborted';
	const text = `${input.message} ${input.providerCode ?? ''}`.toLowerCase();
	if (input.statusCode === 401 || input.statusCode === 403 || /api key|unauthori[sz]ed|forbidden|authentication/.test(text)) return 'auth';
	if (input.statusCode === 413 || /context.?length|context.?window|too many tokens/.test(text)) return 'context_overflow';
	if (/timed? ?out|timeout|deadline/.test(text)) return 'timeout';
	if (/network|fetch failed|connection|socket|econn|enotfound|epipe/.test(text)) return 'network';
	if (input.statusCode !== undefined) return 'api';
	if (/not set|missing api key|configuration/.test(text)) return 'configuration';
	return 'unknown';
}
