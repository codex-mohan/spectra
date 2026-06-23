import type { Message } from '@mohanscodex/spectra-ai';
import { calculateCost } from '@mohanscodex/spectra-ai';
import type { ChatMessage } from '../types.js';
import { genId } from '../utils.js';

export interface ConvertedMessages {
	messages: ChatMessage[];
	tokenUsage: { input: number; output: number };
	costSoFar: number;
}

export function sdkMessagesToChatMessages(data: {
	messages: any[];
	model?: string;
	agent?: string;
}): ConvertedMessages {
	let maxInputTokens = 0;
	let outputTokens = 0;
	let costSoFar = 0;

	for (const m of data.messages) {
		if (m.role === 'assistant' && m.usage) {
			maxInputTokens = Math.max(maxInputTokens, m.usage.input || 0);
			outputTokens += m.usage.output || 0;
			const turnModel = m.model || data.model;
			if (turnModel) {
				const turnCost = calculateCost(turnModel, {
					input: m.usage.input || 0,
					output: m.usage.output || 0,
				});
				costSoFar += turnCost.total;
			}
		}
	}

	const visible = data.messages.filter((m: any) => !m.metadata?.hidden);
	const messages: ChatMessage[] = visible.map((m: any) => {
		const id = genId();
		if (m.role === 'user') {
			return {
				id,
				role: 'user' as const,
				content: typeof m.content === 'string' ? m.content : '',
				model: data.model,
			};
		}
		if (m.role === 'assistant') {
			const blocks = Array.isArray(m.content)
				? m.content.map((c: any) => {
						if (c.type === 'text') return { type: 'text' as const, content: c.text || '' };
						if (c.type === 'thinking')
							return { type: 'thinking' as const, content: c.thinking || c.content || '' };
						if (c.type === 'toolCall')
							return { type: 'toolCall' as const, name: c.name || '', args: JSON.stringify(c.arguments || {}) };
						return { type: 'text' as const, content: '' };
					})
				: [];
			const textContent = blocks
				.filter((b: any) => b.type === 'text')
				.map((b: any) => b.content)
				.join('\n');
			const metadata = m.metadata || {};
			const turnTokens =
				metadata.turnTokens || (m.usage ? { input: m.usage.input || 0, output: m.usage.output || 0 } : undefined);
			return {
				id,
				role: 'assistant' as const,
				content: textContent,
				blocks,
				model: m.model || data.model,
				turnStatus: metadata.turnStatus as 'completed' | 'interrupted' | 'error' | undefined,
				turnDurationMs: metadata.turnDurationMs as number | undefined,
				turnTokens,
				agent: data.agent,
			};
		}
		if (m.role === 'toolResult') {
			const toolOutput = m.content?.[0]?.text || '';
			const args = (m as any).details?.args || {};
			const meta = `${m.toolName}(${JSON.stringify(args)})`;
			return {
				id,
				role: 'tool' as const,
				content: toolOutput,
				meta,
				agent: data.agent,
				toolError: m.isError === true,
				exitCode: typeof (m as any).details?.exitCode === 'number' ? (m as any).details.exitCode : undefined,
				childSessionId: typeof (m as any).details?.childSessionId === 'string' ? (m as any).details.childSessionId : undefined,
				background: (m as any).details?.background === true ? true : undefined,
			};
		}
		return { id, role: 'user' as const, content: '', model: data.model };
	});

	return { messages, tokenUsage: { input: maxInputTokens, output: outputTokens }, costSoFar };
}

export function sdkMessagesToLoadedMessages(data: any): {
	messages: Message[];
	tokenUsage: { input: number; output: number };
} {
	let maxInputTokens = 0;
	let outputTokens = 0;
	for (const m of data.messages as any[]) {
		if (m.role === 'assistant' && m.usage) {
			maxInputTokens = Math.max(maxInputTokens, m.usage.input || 0);
			outputTokens += m.usage.output || 0;
		}
	}
	return {
		messages: data.messages as unknown as Message[],
		tokenUsage: { input: maxInputTokens, output: outputTokens },
	};
}
