import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../agent.js';
import { defineTool } from '../define-tool.js';
import { z } from 'zod';
import type { Model, Message, AssistantMessage } from '@mohanscodex/spectra-ai';
import { AssistantMessageEventStream, registerProvider } from '@mohanscodex/spectra-ai';

const testModel: Model = {
	id: 'claude-sonnet-4-20250514',
	name: 'Claude Sonnet 4',
	provider: 'anthropic',
	api: 'anthropic-messages',
};

describe('Agent', () => {
	it('should create agent instance', () => {
		const agent = new Agent({
			model: testModel,
			systemPrompt: 'You are a helpful assistant.',
		});

		expect(agent).toBeDefined();
	});

	it('should store messages', () => {
		const agent = new Agent({ model: testModel });
		expect(agent.messages).toEqual([]);
	});

	it('should register tools', () => {
		const agent = new Agent({ model: testModel });

		const tool = defineTool({
			name: 'get_weather',
			description: 'Get the current weather',
			parameters: z.object({
				location: z.string().describe('The location to get weather for'),
			}),
			execute: async (args, context) => {
				return {
					content: [{ type: 'text', text: `The weather in ${args.location} is sunny.` }],
				};
			},
		});

		agent.registerTool(tool);
		expect(agent.messages).toEqual([]);
	});

	it('should subscribe and unsubscribe listeners', () => {
		const agent = new Agent({ model: testModel });
		const listener = vi.fn();

		const unsubscribe = agent.subscribe(listener);
		expect(unsubscribe).toBeDefined();

		unsubscribe();
	});

	it('should abort request', () => {
		const agent = new Agent({ model: testModel });
		expect(() => agent.abort()).not.toThrow();
	});

	it('should reset state', () => {
		const agent = new Agent({ model: testModel });
		agent.reset();
		expect(agent.messages).toEqual([]);
		expect(agent.isStreaming).toBe(false);
	});

	it('should return signal', () => {
		const agent = new Agent({ model: testModel });
		const signal = agent.signal;
		expect(signal).toBeUndefined();
	});
});

describe('Agent Queues and Hooks', () => {
	it('should add steering messages to queue', () => {
		const agent = new Agent({ model: testModel });

		agent.steer('Please be more concise');

		// Steering message should be queued (internal state)
		// We can't directly check the queue, but we can verify it doesn't throw
		expect(() => agent.steer('Another message')).not.toThrow();
	});

	it('should add follow-up messages to queue', () => {
		const agent = new Agent({ model: testModel });

		agent.followUp('Can you also check the forecast?');

		// Follow-up message should be queued
		expect(() => agent.followUp('And the temperature?')).not.toThrow();
	});

	it('should accept Message objects in steer and followUp', () => {
		const agent = new Agent({ model: testModel });

		const message: Message = {
			role: 'user',
			content: 'Custom message',
			timestamp: Date.now(),
		};

		expect(() => agent.steer(message)).not.toThrow();
		expect(() => agent.followUp(message)).not.toThrow();
	});
});

	it('should continue with steering messages after a text-only response', async () => {
		let callIndex = 0;
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: [{ type: 'text', text: callIndex === 0 ? 'First response' : 'Steered response' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};
				const delay = callIndex === 0 ? 100 : 0;
				callIndex++;
				setTimeout(() => {
					stream.push({ type: 'done', reason: 'stop', message });
					stream.end(message);
				}, delay);
				return stream;
			},
		});
		const agent = new Agent({ model: testModel });
		agent.steer('Steer now');
		const userEvents: string[] = [];
		for await (const event of agent.run('Initial')) {
			if (event.type === 'message_end' && event.message.role === 'user') {
				userEvents.push(String(event.message.content));
			}
		}


		expect(userEvents).toEqual(['Initial', 'Steer now']);
		expect(seenContexts).toHaveLength(2);
		expect(seenContexts[1].map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('should trigger a new assistant response for steering sent during an active stream', async () => {
		let callIndex = 0;
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: [{ type: 'text', text: callIndex === 0 ? 'First response' : 'Steered response' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};
				const delay = callIndex === 0 ? 50 : 0;
				callIndex++;
				stream.push({ type: 'start', partial: message });
				setTimeout(() => {
					stream.push({ type: 'done', reason: 'stop', message });
					stream.end(message);
				}, delay);
				return stream;
			},
		});
		const agent = new Agent({ model: testModel });
		const userEvents: string[] = [];
		let steered = false;
		for await (const event of agent.run('Initial')) {
			if (event.type === 'message_start' && event.message.role === 'assistant' && !steered) {
				steered = true;
				agent.steer('Steer now');
			}
			if (event.type === 'message_end' && event.message.role === 'user') {
				userEvents.push(String(event.message.content));
			}
		}

		expect(userEvents).toEqual(['Initial', 'Steer now']);
		expect(seenContexts).toHaveLength(2);
		expect(seenContexts[1].map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('should let steering start a new assistant response when maxTurns is one', async () => {
		let callIndex = 0;
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: [{ type: 'text', text: callIndex === 0 ? 'First response' : 'Steered response' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};
				callIndex++;
				setTimeout(() => {
					stream.push({ type: 'done', reason: 'stop', message });
					stream.end(message);
				}, 0);
				return stream;
			},
		});
		const agent = new Agent({ model: testModel, maxTurns: 1 });
		agent.steer('Steer now');

		const assistantMessages: string[] = [];
		for await (const event of agent.run('Initial')) {
			if (event.type === 'message_end' && event.message.role === 'assistant') {
				const message = event.message as AssistantMessage;
				const text = message.content
					.filter((block): block is { type: 'text'; text: string } => block.type === 'text')
					.map((block) => block.text)
					.join('');
				assistantMessages.push(text);
			}
		}

		expect(assistantMessages).toEqual(['First response', 'Steered response']);
		expect(seenContexts).toHaveLength(2);
		expect(seenContexts[1].map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
	});

	it('should trigger a new assistant response when steering is sent after assistant message_end', async () => {
		let callIndex = 0;
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: [{ type: 'text', text: callIndex === 0 ? 'First response' : 'Steered response' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};
				callIndex++;
				stream.push({ type: 'start', partial: message });
				setTimeout(() => {
					stream.push({ type: 'done', reason: 'stop', message });
					stream.end(message);
				}, 10);
				return stream;
			},
		});
		const agent = new Agent({ model: testModel });
		const assistantMessages: string[] = [];
		let steered = false;
		for await (const event of agent.run('Initial')) {
			if (event.type === 'message_end' && event.message.role === 'assistant') {
				assistantMessages.push(
					event.message.content.filter((c): c is { type: 'text'; text: string } => c.type === 'text').map((c) => c.text).join(''),
				);
				// Simulate the UI race: user submits steering right after the assistant
				// response finishes, before agent_end is emitted.
				if (!steered) {
					steered = true;
					agent.steer('Steer now');
				}
			}
		}

		expect(assistantMessages).toEqual(['First response', 'Steered response']);
		expect(seenContexts).toHaveLength(2);
		expect(seenContexts[1].map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
	});


	it('should wait to drain follow-up messages until tool work finishes', async () => {
		let callIndex = 0;
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: callIndex === 0
						? [{ type: 'toolCall', id: 'tool-1', name: 'echo', arguments: { value: 'first' } }]
						: [{ type: 'text', text: callIndex === 1 ? 'Tool response' : 'Follow-up response' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: callIndex === 0 ? 'toolUse' : 'stop',
					timestamp: Date.now(),
				};
				const reason = callIndex === 0 ? 'toolUse' : 'stop';
				callIndex++;
				stream.push({ type: 'start', partial: message });
				setTimeout(() => {
					stream.push({ type: 'done', reason, message });
					stream.end(message);
				}, 0);
				return stream;
			},
		});
		const tool = defineTool({
			name: 'echo',
			description: 'Echo input',
			parameters: z.object({ value: z.string() }),
			execute: async ({ value }) => ({ content: [{ type: 'text' as const, text: value }] }),
		});
		const agent = new Agent({ model: testModel, tools: [tool] });
		let queued = false;
		for await (const event of agent.run('Initial')) {
			if (event.type === 'message_start' && event.message.role === 'assistant' && !queued) {
				queued = true;
				agent.followUp('Follow later');
			}
		}

		expect(seenContexts).toHaveLength(3);
		expect(seenContexts[1].map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult']);
		expect(seenContexts[2].map((message) => message.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant', 'user']);
	});

	it('should clear queued steering and follow-up messages on reset', async () => {
		const seenContexts: Message[][] = [];
		registerProvider({
			name: testModel.provider,
			stream(_model, context) {
				const stream = new AssistantMessageEventStream();
				seenContexts.push([...(context.messages as Message[])]);
				const message: AssistantMessage = {
					role: 'assistant',
					content: [{ type: 'text', text: 'Done' }],
					provider: testModel.provider,
					model: testModel.id,
					usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
					stopReason: 'stop',
					timestamp: Date.now(),
				};
				setTimeout(() => {
					stream.push({ type: 'done', reason: 'stop', message });
					stream.end(message);
				}, 0);
				return stream;
			},
		});
		const agent = new Agent({ model: testModel });
		agent.steer('stale steering');
		agent.followUp('stale follow-up');
		agent.reset();

		for await (const _event of agent.run('Initial')) {
		}

		expect(seenContexts).toHaveLength(1);
		expect(seenContexts[0].map((message) => message.role)).toEqual(['user']);
	});
describe('Agent Retry Logic', () => {
	it('should configure max retry delay', () => {
		const agent = new Agent({
			model: testModel,
			maxRetryDelayMs: 5000,
		});

		expect(agent).toBeDefined();
	});
});

describe('defineTool', () => {
	it('should create tool with Zod schema', () => {
		const tool = defineTool({
			name: 'get_weather',
			description: 'Get the current weather',
			parameters: z.object({
				location: z.string().describe('The location'),
			}),
			execute: async (args, context) => ({
				content: [{ type: 'text', text: 'sunny' }],
			}),
		});

		expect(tool.name).toBe('get_weather');
		expect(tool.description).toBe('Get the current weather');
		expect(tool.parameters).toBeDefined();
	});
});
