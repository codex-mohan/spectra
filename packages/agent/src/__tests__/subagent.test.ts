import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSubagent } from '../subagent.js';
import { defineTool } from '../define-tool.js';
import { z } from 'zod';
import type { Model, AssistantMessage, AssistantMessageEvent } from '@mohanscodex/spectra-ai';
import { AssistantMessageEventStream, registerProvider } from '@mohanscodex/spectra-ai';
import type { AgentEvent } from '../types.js';

const parentModel: Model = {
	id: 'claude-sonnet-4-20250514',
	name: 'Claude Sonnet 4',
	provider: 'test-provider',
	api: 'test',
};

const cheapModel: Model = {
	id: 'deepseek-v4-flash',
	name: 'DeepSeek V4 Flash',
	provider: 'test-provider',
	api: 'test',
};

function createMockProvider(name: string, responseSequence: AssistantMessage[][]) {
	let callIndex = 0;

	return {
		name,
		stream(model: Model, context: any) {
			const stream = new AssistantMessageEventStream();
			const responses = responseSequence[callIndex] || [];
			callIndex++;

			setTimeout(() => {
				const partial: AssistantMessage = {
					role: 'assistant',
					content: [],
					provider: model.provider,
					model: model.id,
					usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};

				stream.push({ type: 'start', partial });

				for (let i = 0; i < responses.length; i++) {
					const msg = responses[i];
					for (const block of msg.content) {
						if (block.type === 'text') {
							stream.push({
								type: 'text_delta',
								contentIndex: i,
								delta: block.text,
								partial: { ...partial, content: [block] },
							});
						} else if (block.type === 'toolCall') {
							stream.push({
								type: 'toolcall_start',
								contentIndex: i,
								partial: { ...partial, content: [block] },
							});
							stream.push({
								type: 'toolcall_end',
								contentIndex: i,
								toolCall: block,
								partial: { ...partial, content: [block] },
							});
						}
					}
				}

				const lastResponse = responses[responses.length - 1] || partial;
				stream.push({
					type: 'done',
					reason: lastResponse.stopReason,
					message: lastResponse,
				});
				stream.end();
			}, 10);

			return stream;
		},
	};
}

function createTextMessage(text: string, stopReason: 'stop' | 'toolUse' = 'stop'): AssistantMessage {
	return {
		role: 'assistant',
		content: [{ type: 'text', text }],
		provider: 'test-provider',
		model: 'test-model',
		usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
		stopReason,
		timestamp: Date.now(),
	};
}

function createToolCallMessage(toolCalls: any[]): AssistantMessage {
	return {
		role: 'assistant',
		content: toolCalls,
		provider: 'test-provider',
		model: 'test-model',
		usage: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 30 },
		stopReason: 'toolUse',
		timestamp: Date.now(),
	};
}

describe('runSubagent', () => {
	beforeEach(() => {
		registerProvider(createMockProvider('test-provider', [[]]));
	});

	it('should run a subagent and return the final text', async () => {
		registerProvider(createMockProvider('test-provider', [[createTextMessage('Found 12 files in src/auth')]]));

		const result = await runSubagent(
			{ model: parentModel, systemPrompt: 'You are an explorer.' },
			'find all auth files',
		);

		expect(result.text).toBe('Found 12 files in src/auth');
		expect(result.aborted).toBe(false);
		expect(result.error).toBeUndefined();
	});

	it('should start with fresh context — no parent history', async () => {
		const provider = createMockProvider('test-provider', [[createTextMessage('done')]]);
		registerProvider(provider);

		await runSubagent({ model: parentModel }, 'do something');

		const result = await runSubagent({ model: parentModel }, 'do something else');
		expect(result.messages.length).toBeLessThanOrEqual(3);
	});

	it('should use modelOverride when provided', async () => {
		let capturedModel: Model | undefined;
		const provider = {
			name: 'test-provider',
			stream(model: Model, context: any) {
				capturedModel = model;
				const stream = new AssistantMessageEventStream();
				const msg = createTextMessage('ok');
				setTimeout(() => {
					stream.push({ type: 'start', partial: msg });
					stream.push({ type: 'done', reason: 'stop', message: msg });
					stream.end();
				}, 10);
				return stream;
			},
		};
		registerProvider(provider);

		await runSubagent(
			{ model: parentModel, modelOverride: cheapModel },
			'test',
		);

		expect(capturedModel?.id).toBe('deepseek-v4-flash');
	});

	it('should fall back to parent model when no override', async () => {
		let capturedModel: Model | undefined;
		const provider = {
			name: 'test-provider',
			stream(model: Model, context: any) {
				capturedModel = model;
				const stream = new AssistantMessageEventStream();
				const msg = createTextMessage('ok');
				setTimeout(() => {
					stream.push({ type: 'start', partial: msg });
					stream.push({ type: 'done', reason: 'stop', message: msg });
					stream.end();
				}, 10);
				return stream;
			},
		};
		registerProvider(provider);

		await runSubagent({ model: parentModel }, 'test');

		expect(capturedModel?.id).toBe('claude-sonnet-4-20250514');
	});

	it('should forward events via onEvent callback', async () => {
		registerProvider(createMockProvider('test-provider', [[createTextMessage('hello')]]));

		const events: AgentEvent[] = [];
		await runSubagent(
			{ model: parentModel, onEvent: (e) => events.push(e) },
			'test',
		);

		expect(events.length).toBeGreaterThan(0);
		expect(events.some((e) => e.type === 'agent_start')).toBe(true);
		expect(events.some((e) => e.type === 'agent_end')).toBe(true);
	});

	it('should accumulate usage across turns', async () => {
		const echoTool = defineTool({
			name: 'echo',
			description: 'Echo back',
			parameters: z.object({ text: z.string() }),
			execute: async ({ text }) => ({
				content: [{ type: 'text', text: `Echo: ${text}` }],
			}),
		});

		const responses = [
			[createToolCallMessage([{ type: 'toolCall', id: 'tc1', name: 'echo', arguments: { text: 'hi' } }])],
			[createTextMessage('final answer')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const result = await runSubagent(
			{ model: parentModel, tools: [echoTool] },
			'echo hi then answer',
		);

		expect(result.usage.input).toBe(20);
		expect(result.usage.output).toBe(40);
		expect(result.usage.totalTokens).toBe(60);
		expect(result.text).toBe('final answer');
	});

	it('should return full transcript in messages', async () => {
		const echoTool = defineTool({
			name: 'echo',
			description: 'Echo',
			parameters: z.object({ text: z.string() }),
			execute: async ({ text }) => ({
				content: [{ type: 'text', text: `Echo: ${text}` }],
			}),
		});

		const responses = [
			[createToolCallMessage([{ type: 'toolCall', id: 'tc1', name: 'echo', arguments: { text: 'hi' } }])],
			[createTextMessage('done')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const result = await runSubagent(
			{ model: parentModel, tools: [echoTool] },
			'test',
		);

		expect(result.messages.length).toBeGreaterThan(2);
		expect(result.text).toBe('done');
	});

	it('should propagate abort signal to child', async () => {
		const controller = new AbortController();
		const provider = {
			name: 'test-provider',
			stream(model: Model, context: any) {
				const stream = new AssistantMessageEventStream();
				const msg = createTextMessage('long response');
				setTimeout(() => {
					stream.push({ type: 'start', partial: msg });
					stream.push({ type: 'text_delta', contentIndex: 0, delta: 'long', partial: msg });
					stream.push({ type: 'done', reason: 'aborted', message: msg });
					stream.end();
				}, 50);
				return stream;
			},
		};
		registerProvider(provider);

		setTimeout(() => controller.abort(), 20);

		const result = await runSubagent(
			{ model: parentModel, signal: controller.signal },
			'test',
		);

		expect(result.aborted).toBe(true);
	});

	it('should enforce budget.maxTurns when set', async () => {
		const responses = [
			[createTextMessage('turn 1', 'toolUse')],
			[createTextMessage('turn 2', 'toolUse')],
			[createTextMessage('turn 3', 'toolUse')],
			[createTextMessage('turn 4')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const noopTool = defineTool({
			name: 'noop',
			description: 'No-op',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
		});

		const result = await runSubagent(
			{ model: parentModel, tools: [noopTool], budget: { maxTurns: 2 } },
			'test',
		);

		expect(result.aborted).toBe(false);
		expect(result.messages.filter((m) => m.role === 'assistant').length).toBeLessThanOrEqual(2);
	});

	it('should be uncapped when budget is undefined', async () => {
		const responses = [
			[createTextMessage('turn 1')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const result = await runSubagent(
			{ model: parentModel },
			'test',
		);

		expect(result.aborted).toBe(false);
		expect(result.error).toBeUndefined();
	});

	it('should enforce budget.maxTokens when exceeded', async () => {
		const responses = [
			[createToolCallMessage([{ type: 'toolCall', id: 'tc1', name: 'noop', arguments: {} }])],
			[createTextMessage('turn 2')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const noopTool = defineTool({
			name: 'noop',
			description: 'No-op',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
		});

		const result = await runSubagent(
			{ model: parentModel, tools: [noopTool], budget: { maxTokens: 40 } },
			'test',
		);

		expect(result.aborted).toBe(true);
		expect(result.error).toContain('Budget exceeded');
	});

	it('should enforce budget.timeoutMs when exceeded', async () => {
		const provider = {
			name: 'test-provider',
			stream(model: Model, context: any) {
				const stream = new AssistantMessageEventStream();
				const msg = createTextMessage('slow');
				setTimeout(() => {
					stream.push({ type: 'start', partial: msg });
					stream.push({ type: 'done', reason: 'stop', message: msg });
					stream.end();
				}, 200);
				return stream;
			},
		};
		registerProvider(provider);

		const result = await runSubagent(
			{ model: parentModel, budget: { timeoutMs: 50 } },
			'test',
		);

		expect(result.aborted).toBe(true);
	});

	it('should return error when the agent fails', async () => {
		const provider = {
			name: 'test-provider',
			stream() {
				throw new Error('Provider down');
			},
		};
		registerProvider(provider);

		const result = await runSubagent(
			{ model: parentModel },
			'test',
		);

		expect(result.error).toBeDefined();
		expect(result.aborted).toBe(false);
	});

	it('should not call onEvent when not provided', async () => {
		registerProvider(createMockProvider('test-provider', [[createTextMessage('ok')]]));

		const result = await runSubagent(
			{ model: parentModel },
			'test',
		);

		expect(result.text).toBe('ok');
	});

	it('should pass tools to child agent', async () => {
		const echoTool = defineTool({
			name: 'echo',
			description: 'Echo',
			parameters: z.object({ text: z.string() }),
			execute: async ({ text }) => ({
				content: [{ type: 'text', text: `Echo: ${text}` }],
			}),
		});

		const responses = [
			[createToolCallMessage([{ type: 'toolCall', id: 'tc1', name: 'echo', arguments: { text: 'hi' } }])],
			[createTextMessage('Echoed: hi')],
		];
		registerProvider(createMockProvider('test-provider', responses));

		const result = await runSubagent(
			{ model: parentModel, tools: [echoTool] },
			'echo hi',
		);

		expect(result.text).toBe('Echoed: hi');
		expect(result.messages.some((m) => m.role === 'toolResult')).toBe(true);
	});
});
