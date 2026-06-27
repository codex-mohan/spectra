import type { Message } from '@mohanscodex/spectra-ai';
import { calculateCost } from '@mohanscodex/spectra-ai';
import type { ChatMessage } from '../types.js';
import { genId } from '../utils.js';
import { getFileVisual } from './file-visuals.js';

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

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- interfaces with untyped SQLite storage
	const visible = data.messages.filter((m: Record<string, unknown>) => {
		const meta = m.metadata as Record<string, unknown> | undefined;
		return !meta?.hidden;
	});
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- interfaces with untyped SQLite storage
	const messages: ChatMessage[] = visible.map((m: Record<string, unknown>) => {
		const id = genId();
		if (m.role === 'user') {
			let content = '';
			let attachments: ChatMessage['attachments'];
			if (typeof m.content === 'string') {
				content = m.content;
			} else if (Array.isArray(m.content)) {
				const textParts: string[] = [];
				const fileAttachments: NonNullable<ChatMessage['attachments']> = [];
				for (const part of m.content) {
					if (part && typeof part === 'object') {
						const p = part as Record<string, unknown>;
						if (p.type === 'text' && typeof p.text === 'string') {
							textParts.push(p.text);
						} else if (p.type === 'file') {
							fileAttachments.push(p as unknown as NonNullable<ChatMessage['attachments']>[number]);
						} else if (p.type === 'image') {
							const mime = (p.mimeType as string) || 'image/png';
							const visual = getFileVisual({ filename: 'image.png', mime });
							fileAttachments.push({
								type: 'file',
								mime,
								filename: 'image.png',
								url: `data:${mime};base64,${(p.data as string) || ''}`,
								badge: { icon: visual.icon, label: visual.label, color: visual.color },
							});
						}
					}
				}
				content = textParts.join('\n');
				if (fileAttachments.length > 0) attachments = fileAttachments;
			}
			return {
				id,
				role: 'user' as const,
				content: content || '',
				attachments,
				model: data.model,
			};
		}
		if (m.role === 'assistant') {
			const contentArr = Array.isArray(m.content) ? m.content : [];
			const blocks = contentArr.map((block: unknown) => {
				const b = block as Record<string, unknown>;
				if (b.type === 'text') return { type: 'text' as const, content: (b.text as string) || '' };
				if (b.type === 'thinking') return { type: 'thinking' as const, content: (b.thinking as string) || (b.content as string) || '' };
				if (b.type === 'toolCall') return { type: 'toolCall' as const, name: (b.name as string) || '', args: JSON.stringify(b.arguments || {}) };
				return { type: 'text' as const, content: '' };
			});
			const textContent = blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
			const metadata = (m.metadata || {}) as Record<string, unknown>;
			const usage = m.usage as Record<string, unknown> | undefined;
			const rawTokens = metadata.turnTokens as Record<string, unknown> | undefined;
			const turnTokens = rawTokens && typeof rawTokens.input === 'number' && typeof rawTokens.output === 'number'
				? { input: rawTokens.input, output: rawTokens.output }
				: usage && typeof usage.input === 'number' && typeof usage.output === 'number'
					? { input: usage.input, output: usage.output }
					: undefined;
			return {
				id,
				role: 'assistant' as const,
				content: textContent,
				blocks,
				model: (m.model as string) || data.model,
				turnStatus: metadata.turnStatus as 'completed' | 'interrupted' | 'error' | undefined,
				turnDurationMs: metadata.turnDurationMs as number | undefined,
				turnTokens,
				agent: data.agent,
			};
		}
		if (m.role === 'toolResult') {
			const contentArr = Array.isArray(m.content) ? m.content : [];
			const toolOutput = (contentArr[0] as Record<string, unknown>)?.text as string || '';
			const details = (m as Record<string, unknown>).details as Record<string, unknown> | undefined;
			const args = (details?.args as Record<string, unknown>) || {};
			const meta = `${m.toolName}(${JSON.stringify(args)})`;
			return {
				id,
				role: 'tool' as const,
				content: toolOutput,
				meta,
				agent: data.agent,
				toolError: m.isError === true,
				exitCode: typeof details?.exitCode === 'number' ? details.exitCode : undefined,
				wallTimeMs: typeof details?.wallTimeMs === 'number' ? details.wallTimeMs : undefined,
				timeoutMs: typeof details?.timeoutMs === 'number' ? details.timeoutMs : undefined,
				childSessionId: typeof details?.childSessionId === 'string' ? details.childSessionId : undefined,
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
