import { createHash } from 'crypto';
import type { AssistantMessage, Context, Message, Tool } from '@mohanscodex/spectra-ai';
import {
	estimateMessageTokens,
	estimateTokens,
	promptTokensFromUsage,
	resolveCompactionBudget,
} from './compaction.js';

export const CONTEXT_GRID_COLUMNS = 20;
export const CONTEXT_GRID_ROWS = 10;
export const CONTEXT_GRID_CELLS = CONTEXT_GRID_COLUMNS * CONTEXT_GRID_ROWS;
export const CONTEXT_GLYPH_FILLED = '⛁';
export const CONTEXT_GLYPH_MESSAGES = '⛃';
export const CONTEXT_GLYPH_FREE = '⛶';
export const CONTEXT_GLYPH_RESERVE = '⛝';

export type ContextCategoryId = 'systemPrompt' | 'systemTools' | 'systemContext' | 'skills' | 'messages';
export type ContextColor = 'accent' | 'warning' | 'context' | 'success' | 'messages' | 'dim';

export interface ContextAttribution {
	baseSystemPrompt: string;
	systemContext: readonly string[];
	skillsHint: string;
	fingerprint: string;
}

export interface PreparedContextSnapshot {
	version: 1;
	modelId: string;
	providerId: string;
	contextWindow: number;
	systemPromptTokens: number;
	systemToolsTokens: number;
	systemContextTokens: number;
	skillsTokens: number;
	nonMessageTokens: number;
	preparedMessagesTokens: number;
	preparedToolHash: string;
	contextFingerprint: string;
	capturedAt: number;
}

export interface ContextUsageSnapshot extends PreparedContextSnapshot {
	messagesTokens: number;
	promptTokens: number;
	anchored: boolean;
}

export interface ContextCategory {
	id: ContextCategoryId;
	label: string;
	tokens: number;
	estimated: boolean;
	glyph: string;
	color: ContextColor;
}

export interface ContextCell {
	glyph: string;
	color: ContextColor;
}

export interface ContextBreakdown {
	modelId: string;
	contextWindow: number;
	usedTokens: number;
	freeTokens: number;
	reserveTokens: number;
	anchored: boolean;
	categories: ContextCategory[];
	cells: ContextCell[];
}

const toolEstimateCache = new Map<string, number>();
const MAX_TOOL_ESTIMATES = 32;

function serializeTools(tools: readonly Tool[], providerId: string): string {
	const provider = providerId.toLowerCase();
	try {
		if (provider.includes('anthropic')) {
			return JSON.stringify(tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				input_schema: tool.parameters,
			}))) ?? '[]';
		}
		if (provider.includes('responses')) {
			return JSON.stringify(tools.map((tool) => ({
				type: 'function',
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				strict: false,
			}))) ?? '[]';
		}
		return JSON.stringify(tools.map((tool) => ({
			type: 'function',
			function: { name: tool.name, description: tool.description, parameters: tool.parameters },
		}))) ?? '[]';
	} catch {
		return tools.map((tool) => `${tool.name}\n${tool.description}`).join('\n');
	}
}

export function estimatePreparedTools(
	tools: readonly Tool[] | undefined,
	providerId: string,
): { hash: string; tokens: number } {
	if (!tools?.length) return { hash: 'none', tokens: 0 };
	const serialized = serializeTools(tools, providerId);
	const hash = createHash('sha256').update(serialized).digest('hex').slice(0, 16);
	const cached = toolEstimateCache.get(hash);
	if (cached !== undefined) return { hash, tokens: cached };
	const tokens = estimateTokens(serialized);
	toolEstimateCache.set(hash, tokens);
	if (toolEstimateCache.size > MAX_TOOL_ESTIMATES) {
		const oldest = toolEstimateCache.keys().next().value;
		if (oldest !== undefined) toolEstimateCache.delete(oldest);
	}
	return { hash, tokens };
}

export function createPreparedContextSnapshot(options: {
	context: Context;
	attribution: ContextAttribution;
	modelId: string;
	providerId: string;
	contextWindow?: number;
}): PreparedContextSnapshot {
	const { context, attribution, modelId, providerId } = options;
	const fullSystemPromptTokens = estimateTokens(context.systemPrompt ?? '');
	const systemPromptTokens = Math.min(fullSystemPromptTokens, estimateTokens(attribution.baseSystemPrompt));
	const skillsTokens = Math.min(
		Math.max(0, fullSystemPromptTokens - systemPromptTokens),
		estimateTokens(attribution.skillsHint),
	);
	let contextMessageTokens = 0;
	for (const message of context.contextMessages ?? []) contextMessageTokens += estimateTokens(message.content);
	const systemContextTokens = Math.max(0, fullSystemPromptTokens - systemPromptTokens - skillsTokens) + contextMessageTokens;
	const toolEstimate = estimatePreparedTools(context.tools, providerId);
	let preparedMessagesTokens = 0;
	for (const message of context.messages) preparedMessagesTokens += estimateMessageTokens(message);
	const nonMessageTokens = systemPromptTokens + skillsTokens + systemContextTokens + toolEstimate.tokens;
	return {
		version: 1,
		modelId,
		providerId,
		contextWindow: options.contextWindow ?? 0,
		systemPromptTokens,
		systemToolsTokens: toolEstimate.tokens,
		systemContextTokens,
		skillsTokens,
		nonMessageTokens,
		preparedMessagesTokens,
		preparedToolHash: toolEstimate.hash,
		contextFingerprint: attribution.fingerprint,
		capturedAt: Date.now(),
	};
}

export function completeContextSnapshot(
	prepared: PreparedContextSnapshot,
	assistant: AssistantMessage,
): ContextUsageSnapshot {
	const promptTokens = assistant.stopReason === 'error' || assistant.stopReason === 'aborted'
		? 0
		: promptTokensFromUsage(assistant.provider, assistant.usage);
	const anchored = promptTokens > 0;
	const messagesAtRequest = anchored
		? Math.max(0, promptTokens - prepared.nonMessageTokens)
		: prepared.preparedMessagesTokens;
	return {
		...prepared,
		messagesTokens: messagesAtRequest + estimateMessageTokens(assistant),
		promptTokens,
		anchored,
		capturedAt: Date.now(),
	};
}

function validSnapshot(value: unknown): value is ContextUsageSnapshot {
	if (!value || typeof value !== 'object') return false;
	const snapshot = value as Partial<ContextUsageSnapshot>;
	return snapshot.version === 1
		&& typeof snapshot.modelId === 'string'
		&& typeof snapshot.providerId === 'string'
		&& typeof snapshot.contextWindow === 'number'
		&& typeof snapshot.nonMessageTokens === 'number'
		&& typeof snapshot.messagesTokens === 'number'
		&& typeof snapshot.systemPromptTokens === 'number'
		&& typeof snapshot.systemToolsTokens === 'number'
		&& typeof snapshot.systemContextTokens === 'number'
		&& typeof snapshot.skillsTokens === 'number';
}

export function restoreLatestContextSnapshot(messages: readonly Message[]): ContextUsageSnapshot | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== 'assistant') continue;
		const candidate = message.metadata?.contextUsage;
		if (validSnapshot(candidate)) return candidate;
	}
	return undefined;
}

function categoryInfo(snapshot: ContextUsageSnapshot): ContextCategory[] {
	return [
		{ id: 'systemPrompt', label: 'System prompt', tokens: snapshot.systemPromptTokens, estimated: true, glyph: CONTEXT_GLYPH_FILLED, color: 'accent' },
		{ id: 'systemTools', label: 'System tools', tokens: snapshot.systemToolsTokens, estimated: true, glyph: CONTEXT_GLYPH_FILLED, color: 'warning' },
		{ id: 'systemContext', label: 'System context', tokens: snapshot.systemContextTokens, estimated: true, glyph: CONTEXT_GLYPH_FILLED, color: 'context' },
		{ id: 'skills', label: 'Skills', tokens: snapshot.skillsTokens, estimated: true, glyph: CONTEXT_GLYPH_FILLED, color: 'success' },
		{ id: 'messages', label: 'Messages', tokens: snapshot.messagesTokens, estimated: !snapshot.anchored, glyph: CONTEXT_GLYPH_MESSAGES, color: 'messages' },
	];
}

function allocateCells(categories: ContextCategory[], reserveTokens: number, contextWindow: number): ContextCell[] {
	if (contextWindow <= 0) {
		return Array.from({ length: CONTEXT_GRID_CELLS }, () => ({ glyph: CONTEXT_GLYPH_FREE, color: 'dim' as const }));
	}
	const tokensPerCell = contextWindow / CONTEXT_GRID_CELLS;
	const counts = categories.map((category) => ({
		category,
		count: category.tokens > 0 ? Math.max(1, Math.round(category.tokens / tokensPerCell)) : 0,
	}));
	let reserveCount = reserveTokens > 0 ? Math.max(1, Math.round(reserveTokens / tokensPerCell)) : 0;
	let occupied = counts.reduce((sum, item) => sum + item.count, 0) + reserveCount;
	if (occupied > CONTEXT_GRID_CELLS) {
		let overflow = occupied - CONTEXT_GRID_CELLS;
		const largest = [...counts].sort((left, right) => right.count - left.count);
		for (const item of largest) {
			const removable = Math.min(overflow, Math.max(0, item.count - 1));
			item.count -= removable;
			overflow -= removable;
			if (overflow === 0) break;
		}
		if (overflow > 0) {
			const removable = Math.min(overflow, reserveCount);
			reserveCount -= removable;
			overflow -= removable;
		}
		if (overflow > 0) {
			for (const item of largest) {
				const removable = Math.min(overflow, item.count);
				item.count -= removable;
				overflow -= removable;
				if (overflow === 0) break;
			}
		}
		occupied = CONTEXT_GRID_CELLS;
	}

	const cells: ContextCell[] = [];
	for (const item of counts) {
		for (let index = 0; index < item.count; index++) {
			cells.push({ glyph: item.category.glyph, color: item.category.color });
		}
	}
	const freeCount = Math.max(0, CONTEXT_GRID_CELLS - occupied);
	for (let index = 0; index < freeCount; index++) cells.push({ glyph: CONTEXT_GLYPH_FREE, color: 'dim' });
	for (let index = 0; index < reserveCount; index++) cells.push({ glyph: CONTEXT_GLYPH_RESERVE, color: 'warning' });
	while (cells.length < CONTEXT_GRID_CELLS) cells.push({ glyph: CONTEXT_GLYPH_FREE, color: 'dim' });
	return cells.slice(0, CONTEXT_GRID_CELLS);
}

export function createContextBreakdown(snapshot: ContextUsageSnapshot): ContextBreakdown {
	const categories = categoryInfo(snapshot);
	const usedTokens = categories.reduce((sum, category) => sum + category.tokens, 0);
	const budget = resolveCompactionBudget(snapshot.contextWindow);
	const available = Math.max(0, snapshot.contextWindow - usedTokens);
	const reserveTokens = Math.min(available, budget?.reserveTokens ?? 0);
	const freeTokens = Math.max(0, snapshot.contextWindow - usedTokens - reserveTokens);
	return {
		modelId: snapshot.modelId,
		contextWindow: snapshot.contextWindow,
		usedTokens,
		freeTokens,
		reserveTokens,
		anchored: snapshot.anchored,
		categories,
		cells: allocateCells(categories, reserveTokens, snapshot.contextWindow),
	};
}
