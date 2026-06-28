import type { FileContent, Message } from '@mohanscodex/spectra-ai';
import { calculateCost } from '@mohanscodex/spectra-ai';
import type { ChatMessage } from '../types.js';
import { genId } from '../utils.js';
import { getFileVisual } from './file-visuals.js';
import type { PromptAttachment } from '../prompt-bar.js';

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
							const attachment = hydrateFileAttachment(p);
							if (attachment) fileAttachments.push(attachment);
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

function hydrateFileAttachment(value: Record<string, unknown>): PromptAttachment | null {
	const mime = typeof value.mime === 'string' ? value.mime : null;
	const filename = typeof value.filename === 'string' ? value.filename : null;
	const url = typeof value.url === 'string' ? value.url : null;
	if (!mime || !filename || !url) return null;

	const file: FileContent = {
		type: 'file',
		mime,
		filename,
		url,
	};

	if ('source' in value && isRecord(value.source)) {
		const source = hydrateFileSource(value.source);
		if (source) file.source = source;
	}

	if ('metadata' in value && isRecord(value.metadata)) {
		const metadata = hydrateFileMetadata(value.metadata);
		if (metadata) file.metadata = metadata;
	}

	const visual = getFileVisual(file);
	return { ...file, badge: { icon: visual.icon, label: visual.label, color: visual.color } };
}

function hydrateFileSource(value: Record<string, unknown>): FileContent['source'] | null {
	if (value.type !== 'file' && value.type !== 'clipboard' && value.type !== 'directory') return null;
	const source: FileContent['source'] = { type: value.type };
	if (typeof value.path === 'string') source.path = value.path;
	if (isRecord(value.text)) {
		const start = typeof value.text.start === 'number' ? value.text.start : null;
		const end = typeof value.text.end === 'number' ? value.text.end : null;
		const textValue = typeof value.text.value === 'string' ? value.text.value : null;
		if (start !== null && end !== null && textValue !== null) {
			source.text = { start, end, value: textValue };
		}
	}
	return source;
}

function hydrateFileMetadata(value: Record<string, unknown>): FileContent['metadata'] | null {
	const metadata: NonNullable<FileContent['metadata']> = {};
	if (typeof value.sizeBytes === 'number') metadata.sizeBytes = value.sizeBytes;
	if (typeof value.width === 'number') metadata.width = value.width;
	if (typeof value.height === 'number') metadata.height = value.height;
	if (typeof value.durationMs === 'number') metadata.durationMs = value.durationMs;
	if (typeof value.files === 'number') metadata.files = value.files;
	return Object.keys(metadata).length > 0 ? metadata : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
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
