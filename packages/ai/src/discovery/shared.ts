import type { ModelInfo } from '../registry.js';
import { isRecord } from '../guards.js';

/** Envelope keys used by OpenAI-compatible gateways, OpenRouter, and proxies. */
const ENVELOPE_KEYS = ['data', 'models', 'result', 'items'] as const;

function firstPositiveNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	}
	return undefined;
}

/**
 * Pull model rows out of the envelopes gateways actually return: a bare array,
 * or an object nesting the array under `data`, `models`, `result`, or `items`.
 */
export function extractModelRows(payload: unknown): Record<string, unknown>[] {
	if (Array.isArray(payload)) return payload.filter(isRecord);
	if (!isRecord(payload)) return [];
	for (const key of ENVELOPE_KEYS) {
		const value = payload[key];
		if (Array.isArray(value)) return value.filter(isRecord);
		if (isRecord(value)) {
			const nested = extractModelRows(value);
			if (nested.length > 0) return nested;
		}
	}
	return [];
}

/** Context window precedence: native fields, then provider limits, then the fallback. */
export function normalizeContextWindow(row: Record<string, unknown>, fallback?: number): number | undefined {
	const limits = isRecord(row.limits) ? row.limits : undefined;
	const limitSum = typeof limits?.max_input_tokens === 'number' && typeof limits.max_output_tokens === 'number'
		? limits.max_input_tokens + limits.max_output_tokens
		: undefined;
	return firstPositiveNumber(row.max_model_len, row.context_length, row.context_window, limitSum) ?? fallback;
}

/** Output cap, clamped to the context window so a bad feed cannot over-advertise it. */
export function normalizeMaxOutputTokens(row: Record<string, unknown>, contextWindow?: number): number | undefined {
	const limits = isRecord(row.limits) ? row.limits : undefined;
	const topProvider = isRecord(row.top_provider) ? row.top_provider : undefined;
	const max = firstPositiveNumber(
		limits?.max_output_tokens,
		row.max_output_tokens,
		row.max_completion_tokens,
		topProvider?.max_completion_tokens,
		row.max_tokens,
	);
	if (max === undefined) return undefined;
	return contextWindow === undefined ? max : Math.min(max, contextWindow);
}

/** Modalities from any of the shapes OpenAI, OpenRouter, and proxies use. */
export function normalizeSupportedInputs(row: Record<string, unknown>): string[] | undefined {
	const architecture = isRecord(row.architecture) ? row.architecture : undefined;
	const candidates = [row.input, row.input_modalities, row.supported_inputs, architecture?.input_modalities];
	for (const value of candidates) {
		if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) return value as string[];
	}
	return undefined;
}

export function normalizeSupportsTools(row: Record<string, unknown>): boolean | undefined {
	if (Array.isArray(row.supported_parameters)) return row.supported_parameters.includes('tools');
	if (typeof row.supports_tools === 'boolean') return row.supports_tools;
	return undefined;
}

/** Normalize one provider row; rows without a usable id are dropped. */
export function normalizeModelRow(row: Record<string, unknown>): ModelInfo | null {
	const id = typeof row.id === 'string' && row.id.length > 0 ? row.id : undefined;
	if (!id) return null;
	const name = typeof row.name === 'string' && row.name.length > 0
		? row.name
		: typeof row.display_name === 'string' && row.display_name.length > 0
			? row.display_name
			: id;
	const contextWindow = normalizeContextWindow(row);
	return {
		id,
		name,
		contextWindow,
		maxTokens: normalizeMaxOutputTokens(row, contextWindow),
		reasoning: typeof row.reasoning === 'boolean' ? row.reasoning : undefined,
		supportsTools: normalizeSupportsTools(row),
		supportedInputs: normalizeSupportedInputs(row),
	};
}

export function normalizeModelRows(payload: unknown): ModelInfo[] {
	return extractModelRows(payload)
		.map(normalizeModelRow)
		.filter((model): model is ModelInfo => model !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}
