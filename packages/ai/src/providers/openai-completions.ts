import OpenAI from 'openai';
import type {
	ChatCompletionAssistantMessageParam,
	ChatCompletionMessageParam,
} from 'openai/resources/chat/completions.js';
import type {
	AssistantMessage,
	Context,
	Model,
	StreamOptions,
	TextContent,
	ThinkingContent,
	ToolCall,
} from '../types.js';
import { AssistantMessageEventStream } from '../event-stream.js';
import { sanitizeSurrogates, parseStreamingJson } from './shared.js';

function getEnvApiKey(provider: string): string | undefined {
	const keys: Record<string, string | undefined> = {
		openai: process.env.OPENAI_API_KEY,
		openaiCodex: process.env.OPENAI_API_KEY,
		openrouter: process.env.OPENROUTER_API_KEY,
		groq: process.env.GROQ_API_KEY,
		azure: process.env.AZURE_OPENAI_API_KEY,
		cerebras: process.env.CEREBRAS_API_KEY,
		xai: process.env.XAI_API_KEY,
	};
	return keys[provider];
}

export interface OpenAICompletionsOptions extends StreamOptions {
	toolChoice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
	reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
}

export function createOpenAICompletionsProvider() {
	return {
		name: 'openai-completions',
		listModels: () => import('../models.js').then((m) => m.getProviderModels('openai')),
		stream(model: Model, context: Context, options?: OpenAICompletionsOptions): AssistantMessageEventStream {
			const stream = new AssistantMessageEventStream();

			const run = async () => {
				const output: AssistantMessage = {
					role: 'assistant',
					content: [],
					provider: model.provider,
					model: model.id,
					responseId: undefined,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};

				try {
					const apiKey = options?.apiKey ?? getEnvApiKey(model.provider);
					if (!apiKey) {
						output.stopReason = 'error';
						output.errorMessage = `No API key for provider: ${model.provider}`;
						stream.push({ type: 'start', partial: output });
						stream.push({ type: 'error', reason: 'error', error: output });
						stream.end();
						return;
					}

					const client = new OpenAI({
						apiKey,
						baseURL: model.baseUrl,
						dangerouslyAllowBrowser: true,
					});

					const messages = convertMessages(model, context);
					maybeAddOpenRouterAnthropicCacheControl(model, messages);

					const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
						model: model.id,
						messages,
						stream: true,
						stream_options: { include_usage: true },
					};

					if (options?.maxTokens) {
						params.max_completion_tokens = options.maxTokens;
					}

					if (options?.temperature !== undefined) {
						params.temperature = options.temperature;
					}

					if (options?.toolChoice) {
						params.tool_choice = options.toolChoice;
					}

					const reasoningEffort =
						options?.reasoningEffort ||
						(options?.thinkingEffort && options.thinkingEffort !== 'none'
							? options.thinkingEffort === 'max'
								? 'high'
								: options.thinkingEffort
							: undefined);
					if (reasoningEffort) {
						(params as any).reasoning_effort = reasoningEffort;
					}

					// zai/zhipuai need thinking enabled for reasoning models
					if (['zai', 'zhipuai'].some((id) => model.provider.toLowerCase().includes(id))) {
						(params as any).thinking = { type: 'enabled', clear_thinking: false };
					}

					// alibaba-cn/DashScope needs enable_thinking for reasoning models
					if (model.provider.toLowerCase().includes('alibaba')) {
						(params as any).enable_thinking = true;
					}

					if (context.tools) {
						params.tools = context.tools.map((tool) => ({
							type: 'function' as const,
							function: {
								name: tool.name,
								description: tool.description,
								parameters: tool.parameters,
							},
						}));
					}

					const openaiStream = await client.chat.completions.create(params, { signal: options?.signal });
					stream.push({ type: 'start', partial: output });

					let currentBlock: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null = null;
					const blocks = output.content;
					const blockIndex = () => blocks.length - 1;

					for await (const chunk of openaiStream) {
						if (!chunk || typeof chunk !== 'object') continue;

						output.responseId = output.responseId || chunk.id;
						if (chunk.usage) {
							output.usage = parseChunkUsage(chunk.usage);
						}

						const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
						if (!choice) continue;

						if (choice.finish_reason) {
							output.stopReason = mapStopReason(choice.finish_reason);
						}

						if (choice.delta) {
							if (choice.delta.content && choice.delta.content.length > 0) {
								if (!currentBlock || currentBlock.type !== 'text') {
									finishCurrentBlock(currentBlock, output, stream, blockIndex);
									currentBlock = { type: 'text', text: '' };
									output.content.push(currentBlock);
									stream.push({ type: 'text_start', contentIndex: blockIndex(), partial: output });
								}

								if (currentBlock.type === 'text') {
									currentBlock.text += choice.delta.content;
									stream.push({
										type: 'text_delta',
										contentIndex: blockIndex(),
										delta: choice.delta.content,
										partial: output,
									});
								}
							}

							const reasoningFields = ['reasoning_content', 'reasoning', 'reasoning_text'];
							let foundReasoningField: string | null = null;
							for (const field of reasoningFields) {
								if (
									(choice.delta as Record<string, unknown>)[field] &&
									String((choice.delta as Record<string, unknown>)[field]).length > 0
								) {
									if (!foundReasoningField) {
										foundReasoningField = field;
										break;
									}
								}
							}

							if (foundReasoningField) {
								if (!currentBlock || currentBlock.type !== 'thinking') {
									finishCurrentBlock(currentBlock, output, stream, blockIndex);
									currentBlock = {
										type: 'thinking',
										thinking: '',
										thinkingSignature: foundReasoningField,
									};
									output.content.push(currentBlock);
									stream.push({ type: 'thinking_start', contentIndex: blockIndex(), partial: output });
								}

								if (currentBlock.type === 'thinking') {
									const delta = String((choice.delta as Record<string, unknown>)[foundReasoningField]);
									currentBlock.thinking += delta;
									stream.push({
										type: 'thinking_delta',
										contentIndex: blockIndex(),
										delta,
										partial: output,
									});
								}
							}

							if (choice.delta.tool_calls) {
								for (const toolCall of choice.delta.tool_calls) {
									if (
										!currentBlock ||
										currentBlock.type !== 'toolCall' ||
										(toolCall.id && currentBlock.id !== toolCall.id)
									) {
										finishCurrentBlock(currentBlock, output, stream, blockIndex);
										currentBlock = {
											type: 'toolCall',
											id: toolCall.id || '',
											name: toolCall.function?.name || '',
											arguments: {},
											partialArgs: '',
										};
										output.content.push(currentBlock);
										stream.push({ type: 'toolcall_start', contentIndex: blockIndex(), partial: output });
									}

									if (currentBlock.type === 'toolCall') {
										if (toolCall.id) currentBlock.id = toolCall.id;
										if (toolCall.function?.name) currentBlock.name = toolCall.function.name;
										let delta = '';
										if (toolCall.function?.arguments) {
											delta = toolCall.function.arguments;
											currentBlock.partialArgs += toolCall.function.arguments;
											currentBlock.arguments = parseStreamingJson(currentBlock.partialArgs || '');
										}
										if (delta) {
											stream.push({
												type: 'toolcall_delta',
												contentIndex: blockIndex(),
												delta,
												partial: output,
											});
										}
									}
								}
							}
						}
					}

					finishCurrentBlock(currentBlock, output, stream, blockIndex);
					if (options?.signal?.aborted) {
						throw new Error('Request was aborted');
					}

					stream.push({ type: 'done', reason: output.stopReason, message: output });
					stream.end();
				} catch (error) {
					output.stopReason = options?.signal?.aborted ? 'aborted' : 'error';
					output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
					// Some providers via OpenRouter give additional information in this field.
					const rawMetadata = (error as any)?.error?.metadata?.raw;
					if (rawMetadata) output.errorMessage += `\n${rawMetadata}`;
					stream.push({ type: 'error', reason: output.stopReason, error: output });
					stream.end();
				}
			};

			run();
			return stream;
		},
	};
}

function finishCurrentBlock(
	block: TextContent | ThinkingContent | (ToolCall & { partialArgs?: string }) | null,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	blockIndex: () => number,
): void {
	if (!block) return;

	if (block.type === 'text') {
		stream.push({
			type: 'text_end',
			contentIndex: blockIndex(),
			content: block.text,
			partial: output,
		});
	} else if (block.type === 'thinking') {
		stream.push({
			type: 'thinking_end',
			contentIndex: blockIndex(),
			content: block.thinking,
			partial: output,
		});
	} else if (block.type === 'toolCall') {
		block.arguments = parseStreamingJson(block.partialArgs || '');
		stream.push({
			type: 'toolcall_end',
			contentIndex: blockIndex(),
			toolCall: block,
			partial: output,
		});
	}
}

function maybeAddOpenRouterAnthropicCacheControl(
	model: Model,
	messages: ChatCompletionMessageParam[],
): void {
	if (model.provider !== 'openrouter' || !model.id.startsWith('anthropic/')) return;
	if (process.env.SPECTRA_CACHE_RETENTION === 'none') return;

	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== 'user' && msg.role !== 'assistant') continue;

		const content = (msg as any).content;
		if (typeof content === 'string') {
			(msg as any).content = [
				Object.assign({ type: 'text' as const, text: content }, { cache_control: { type: 'ephemeral' } }),
			];
			return;
		}

		if (!Array.isArray(content)) continue;

		for (let j = content.length - 1; j >= 0; j--) {
			const part = content[j];
			if (part?.type === 'text') {
				Object.assign(part, { cache_control: { type: 'ephemeral' } });
				return;
			}
		}
	}
}

function convertMessages(model: Model, context: Context): ChatCompletionMessageParam[] {
	const params: ChatCompletionMessageParam[] = [];

	if (context.systemPrompt) {
		params.push({ role: 'system', content: sanitizeSurrogates(context.systemPrompt) });
	}

	for (const msg of context.messages) {
		if (msg.role === 'user') {
			if (typeof msg.content === 'string') {
				params.push({ role: 'user', content: sanitizeSurrogates(msg.content) });
			} else {
				const content = msg.content.map((item) => {
					if (item.type === 'text') {
						return { type: 'text' as const, text: sanitizeSurrogates(item.text) };
					}
					return {
						type: 'image_url' as const,
						image_url: { url: `data:${item.mimeType};base64,${item.data}` },
					};
				});
				params.push({ role: 'user', content });
			}
		} else if (msg.role === 'assistant') {
			const textBlocks = msg.content.filter((b) => b.type === 'text') as TextContent[];
			const thinkingBlocks = msg.content.filter(
				(b) => b.type === 'thinking' && !(b as ThinkingContent).redacted,
			) as ThinkingContent[];
			const toolCalls = msg.content.filter((b) => b.type === 'toolCall') as ToolCall[];

			if (textBlocks.length > 0 || thinkingBlocks.length > 0 || toolCalls.length > 0) {
				const assistantMsg = {
					role: 'assistant' as const,
					content: textBlocks.map((b) => sanitizeSurrogates(b.text)).join('') || null,
				} as Record<string, unknown>;

				if (thinkingBlocks.length > 0) {
					assistantMsg.reasoning_content = thinkingBlocks.map((t) => t.thinking).join('\n');
				}

				if (toolCalls.length > 0) {
					assistantMsg.tool_calls = toolCalls.map((tc) => ({
						id: tc.id,
						type: 'function' as const,
						function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
					}));
				}

				params.push(assistantMsg as unknown as ChatCompletionAssistantMessageParam);
			}
		} else if (msg.role === 'toolResult') {
			const textResult = msg.content
				.filter((c) => c.type === 'text')
				.map((c) => (c as TextContent).text)
				.join('\n');

			params.push({
				role: 'tool',
				content: sanitizeSurrogates(textResult || '(no result)'),
				tool_call_id: msg.toolCallId,
			});
		}
	}

	// Defensive repair: some providers (e.g. DeepSeek) are strict about every
	// assistant `tool_calls` being followed by matching `role: "tool"` messages.
	// If tool results went missing (e.g. parallel permission-dialog race, crash,
	// or provider leniency like OpenRouter), inject synthetic error results so
	// the request is not rejected.
	const repaired: ChatCompletionMessageParam[] = [];
	for (let i = 0; i < params.length; i++) {
		const msg = params[i];
		repaired.push(msg);
		if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0) {
			const requiredIds = new Set<string>((msg as any).tool_calls.map((tc: any) => tc.id));
			let j = i + 1;
			while (j < params.length && params[j].role === 'tool') {
				requiredIds.delete((params[j] as any).tool_call_id);
				j++;
			}
			for (const missingId of requiredIds) {
				repaired.push({
					role: 'tool',
					content: '(tool result missing — the call may have been interrupted or blocked)',
					tool_call_id: missingId,
				});
			}
		}
	}

	return repaired;
}

function parseChunkUsage(rawUsage: {
	prompt_tokens?: number;
	completion_tokens?: number;
	prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
}): AssistantMessage['usage'] {
	const promptTokens = rawUsage.prompt_tokens || 0;
	const cachedTokens = rawUsage.prompt_tokens_details?.cached_tokens || 0;
	const cacheWriteTokens = rawUsage.prompt_tokens_details?.cache_write_tokens || 0;

	return {
		input: promptTokens,
		output: rawUsage.completion_tokens || 0,
		cacheRead: cachedTokens,
		cacheWrite: cacheWriteTokens,
		totalTokens: promptTokens + (rawUsage.completion_tokens || 0),
	};
}

function mapStopReason(reason: string | null): 'stop' | 'length' | 'toolUse' | 'error' | 'aborted' {
	if (reason === null) return 'stop';
	switch (reason) {
		case 'stop':
		case 'end':
			return 'stop';
		case 'length':
			return 'length';
		case 'function_call':
		case 'tool_calls':
			return 'toolUse';
		default:
			return reason === 'content_filter' || reason === 'network_error' ? 'error' : 'stop';
	}
}
