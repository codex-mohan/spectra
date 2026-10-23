import { describe, expect, it } from 'vitest';
import {
	extractModelRows,
	normalizeContextWindow,
	normalizeMaxOutputTokens,
	normalizeModelRow,
	normalizeModelRows,
	normalizeSupportedInputs,
	normalizeSupportsTools,
} from '../discovery/shared.js';

describe('discovery normalization', () => {
	it('extracts rows from every supported envelope', () => {
		expect(extractModelRows([{ id: 'a' }])).toHaveLength(1);
		expect(extractModelRows({ data: [{ id: 'a' }] })).toHaveLength(1);
		expect(extractModelRows({ models: [{ id: 'a' }] })).toHaveLength(1);
		expect(extractModelRows({ result: [{ id: 'a' }] })).toHaveLength(1);
		expect(extractModelRows({ items: [{ id: 'a' }] })).toHaveLength(1);
		expect(extractModelRows({ data: { models: [{ id: 'a' }] } })).toHaveLength(1);
		expect(extractModelRows({ nope: [] })).toEqual([]);
		expect(extractModelRows(null)).toEqual([]);
	});

	it('prefers native context fields over limits and the fallback', () => {
		expect(normalizeContextWindow({ max_model_len: 4096, context_length: 2048 })).toBe(4096);
		expect(normalizeContextWindow({ context_length: 2048 })).toBe(2048);
		expect(normalizeContextWindow({ limits: { max_input_tokens: 1000, max_output_tokens: 500 } })).toBe(1500);
		expect(normalizeContextWindow({}, 128_000)).toBe(128_000);
	});

	it('clamps the output cap to the context window', () => {
		expect(normalizeMaxOutputTokens({ max_tokens: 64_000 }, 32_000)).toBe(32_000);
		expect(normalizeMaxOutputTokens({ limits: { max_output_tokens: 8000 } }, 32_000)).toBe(8000);
		expect(normalizeMaxOutputTokens({}, 32_000)).toBeUndefined();
	});

	it('reads modalities and tool support from every shape', () => {
		expect(normalizeSupportedInputs({ input: ['text', 'image'] })).toEqual(['text', 'image']);
		expect(normalizeSupportedInputs({ architecture: { input_modalities: ['text'] } })).toEqual(['text']);
		expect(normalizeSupportedInputs({ supported_inputs: ['text'] })).toEqual(['text']);
		expect(normalizeSupportsTools({ supported_parameters: ['tools'] })).toBe(true);
		expect(normalizeSupportsTools({ supports_tools: false })).toBe(false);
	});

	it('builds rows and drops entries without an id', () => {
		const rows = normalizeModelRows({
			data: [
				{ id: 'b', display_name: 'Beta', context_length: 128_000 },
				{ name: 'No id' },
				{ id: 'a' },
			],
		});

		expect(rows.map((row) => row.id)).toEqual(['a', 'b']);
		expect(rows[1]).toMatchObject({ id: 'b', name: 'Beta', contextWindow: 128_000 });
		expect(normalizeModelRow({ name: 'x' })).toBeNull();
	});
});
