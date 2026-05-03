import { describe, expect, it } from 'vitest';
import { normalizeOpenAIBaseUrl } from '../services/custom-providers.js';

describe('custom providers', () => {
	it('normalizes full OpenAI endpoint URLs to base URLs', () => {
		expect(normalizeOpenAIBaseUrl('https://api.neuralwatt.com/v1/chat/completions')).toBe('https://api.neuralwatt.com/v1');
		expect(normalizeOpenAIBaseUrl('https://api.example.com/v1/responses/')).toBe('https://api.example.com/v1');
		expect(normalizeOpenAIBaseUrl('https://api.example.com/v1')).toBe('https://api.example.com/v1');
	});
});
