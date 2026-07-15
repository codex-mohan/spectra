import { describe, expect, it } from 'vitest';
import { normalizeProviderError } from '../index.js';

describe('normalizeProviderError', () => {
	it('preserves useful response diagnostics while redacting secrets', () => {
		const error = Object.assign(new Error('Provider rejected bearer sk-live-secret'), {
			status: 429,
			code: 'rate_limit_exceeded',
			response: {
				headers: {
					'retry-after': '2',
					'x-request-id': 'req_123',
					authorization: 'Bearer sk-live-secret',
				},
				body: 'request failed: api_key=sk-live-secret',
			},
		});

		const details = normalizeProviderError(error);

		expect(details).toMatchObject({
			kind: 'api',
			retryable: true,
			statusCode: 429,
			providerCode: 'rate_limit_exceeded',
			retryAfterMs: 2_000,
			responseHeaders: { 'retry-after': '2', 'x-request-id': 'req_123' },
		});
		expect(details.message).not.toContain('sk-live-secret');
		expect(details.responseBody).not.toContain('sk-live-secret');
	});

	it('classifies non-retryable failures and bounded response bodies', () => {
		const error = Object.assign(new Error('Context length exceeded'), {
			statusCode: 413,
			responseBody: 'x'.repeat(40_000),
		});

		const details = normalizeProviderError(error);

		expect(details).toMatchObject({ kind: 'context_overflow', retryable: false, statusCode: 413, responseBodyTruncated: true });
		expect(details.responseBody).toHaveLength(32_768);
	});

	it('classifies aborted requests without retrying', () => {
		const details = normalizeProviderError(new Error('Request aborted'), { aborted: true });
		expect(details).toMatchObject({ kind: 'aborted', retryable: false });
	});
});
