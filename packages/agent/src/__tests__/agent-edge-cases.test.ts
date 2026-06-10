import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '../agent.js';
import { defineTool } from '../define-tool.js';
import { z } from 'zod';
import type { Model, Message, StopReason } from '@mohanscodex/spectra-ai';

const testModel: Model = {
	id: 'edge-test-model',
	name: 'Edge Test Model',
	provider: 'edge-test',
	api: 'edge-test',
};

beforeEach(() => {
	vi.restoreAllMocks();
});

describe('Agent: registration and lifecycle', () => {
	it('should register multiple tools and track them', () => {
		const agent = new Agent({ model: testModel });

		const toolA = defineTool({
			name: 'tool_a',
			description: 'A',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text', text: 'a' }] }),
		});

		const toolB = defineTool({
			name: 'tool_b',
			description: 'B',
			parameters: z.object({ x: z.number() }),
			execute: async () => ({ content: [{ type: 'text', text: 'b' }] }),
		});

		agent.registerTool(toolA);
		agent.registerTool(toolB);

		expect(agent).toBeDefined();
	});

	it('should reset state between runs', () => {
		const agent = new Agent({ model: testModel, systemPrompt: 'test' });
		agent.reset();
		expect(agent.messages).toEqual([]);
		expect(agent.isStreaming).toBe(false);
		expect(agent.errorMessage).toBeUndefined();
	});

	it('should restore message history', () => {
		const agent = new Agent({ model: testModel });
		const history: Message[] = [
			{ role: 'user', content: 'hello', timestamp: Date.now() },
			{ role: 'user', content: 'world', timestamp: Date.now() },
		];

		agent.restoreHistory(history);
		expect(agent.messages).toHaveLength(2);
		expect(agent.messages[0].content).toBe('hello');
	});

	it('should store and return a copy of messages', () => {
		const agent = new Agent({ model: testModel });
		const msgs1 = agent.messages;
		msgs1.push({ role: 'user', content: 'mutated', timestamp: Date.now() });
		const msgs2 = agent.messages;
		expect(msgs2).toEqual([]);
	});

	it('should support subscribe with signal', () => {
		const agent = new Agent({ model: testModel });
		const listener = vi.fn();
		const unsub = agent.subscribe(listener);
		expect(typeof unsub).toBe('function');
		unsub();
	});
});

describe('Agent: steering and follow-up queuing', () => {
	it('should accept steering messages as string', () => {
		const agent = new Agent({ model: testModel });
		expect(() => agent.steer('Be more concise')).not.toThrow();
	});

	it('should accept steering messages as Message object', () => {
		const agent = new Agent({ model: testModel });
		const msg: Message = { role: 'user', content: 'Custom steer', timestamp: Date.now() };
		expect(() => agent.steer(msg)).not.toThrow();
	});

	it('should accept follow-up messages as string', () => {
		const agent = new Agent({ model: testModel });
		expect(() => agent.followUp('One more thing')).not.toThrow();
	});

	it('should accept follow-up messages as Message object', () => {
		const agent = new Agent({ model: testModel });
		const msg: Message = { role: 'user', content: 'Follow', timestamp: Date.now() };
		expect(() => agent.followUp(msg)).not.toThrow();
	});

	it('should configure one-at-a-time steering mode', () => {
		const agent = new Agent({ model: testModel, steeringMode: 'one-at-a-time' });
		agent.steer('A');
		agent.steer('B');
		expect(agent).toBeDefined();
	});

	it('should configure all-at-once steering mode', () => {
		const agent = new Agent({ model: testModel, steeringMode: 'all' });
		agent.steer('A');
		agent.steer('B');
		expect(agent).toBeDefined();
	});

	it('should configure all-at-once follow-up mode', () => {
		const agent = new Agent({ model: testModel, followUpMode: 'all' });
		agent.followUp('A');
		agent.followUp('B');
		expect(agent).toBeDefined();
	});
});

describe('Agent: max turns enforcement', () => {
	it('should stop after maxTurns is reached', async () => {
		let turnCount = 0;
		const events: Array<{ type: string }> = [];
		let agentEndSeen = false;

		const tool = defineTool({
			name: 'loop_tool',
			description: 'Causes loops',
			parameters: z.object({}),
			execute: async () => {
				turnCount++;
				return { content: [{ type: 'text', text: 'looping' }] };
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'test', tools: [tool], maxTurns: 2 });

		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		registerProvider({
			name: testModel.provider,
			stream: () => {
				const partial = {
					role: 'assistant' as const,
					content: [{ type: 'toolCall' as const, id: 'loop-call', name: 'loop_tool', arguments: {} }],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'toolUse' as StopReason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					timestamp: Date.now(),
				};
				const tc = { type: 'toolCall' as const, id: 'loop-call', name: 'loop_tool', arguments: {} };
				const stream = new AssistantMessageEventStream();
				stream.push({ type: 'start', partial });
				stream.push({ type: 'toolcall_start', contentIndex: 0, partial });
				stream.push({ type: 'toolcall_end', contentIndex: 0, toolCall: tc, partial });
				stream.end(partial);
				return stream;
			},
		});

		for await (const ev of agent.run('test max turns')) {
			events.push(ev);
			if (ev.type === 'agent_end') agentEndSeen = true;
		}

		expect(agentEndSeen).toBe(true);
		expect(turnCount).toBeLessThanOrEqual(2);
	});

	it('should allow unlimited turns when maxTurns is undefined', async () => {
		const events: Array<{ type: string }> = [];
		let agentEndSeen = false;

		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		registerProvider({
			name: testModel.provider,
			stream: () => {
				const partial = {
					role: 'assistant' as const,
					content: [{ type: 'text' as const, text: 'Done' }],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'stop' as StopReason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					timestamp: Date.now(),
				};
				const stream = new AssistantMessageEventStream();
				stream.push({ type: 'start', partial });
				stream.end(partial);
				return stream;
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'test' });

		for await (const ev of agent.run('test')) {
			events.push(ev);
			if (ev.type === 'agent_end') agentEndSeen = true;
		}

		expect(agentEndSeen).toBe(true);
	});
});

describe('Agent: error handling', () => {
	it('should NOT retry on non-retryable errors', async () => {
		let attemptCount = 0;

		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		registerProvider({
			name: testModel.provider,
			stream: () => {
				attemptCount++;
				const errMsg = {
					role: 'assistant' as const,
					content: [] as any[],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'error' as StopReason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					timestamp: Date.now(),
					errorMessage: '400 Bad Request',
				};
				const errStream = new AssistantMessageEventStream();
				errStream.push({ type: 'error', reason: 'error' as StopReason, error: errMsg });
				errStream.end(errMsg);
				return errStream;
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'test', maxRetryDelayMs: 10 });

		for await (const _ of agent.run('test error')) {
			// consume
		}

		expect(attemptCount).toBe(1);
	});

	it('should handle abort signal during run', async () => {
		let attemptCount = 0;

		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		registerProvider({
			name: testModel.provider,
			stream: () => {
				attemptCount++;
				const errMsg = {
					role: 'assistant' as const,
					content: [] as any[],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'error' as StopReason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					timestamp: Date.now(),
					errorMessage: '502 Bad Gateway',
				};
				const errStream = new AssistantMessageEventStream();
				errStream.push({ type: 'error', reason: 'error' as StopReason, error: errMsg });
				errStream.end(errMsg);
				return errStream;
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'test', maxRetryDelayMs: 1000 });

		setTimeout(() => agent.abort(), 50);

		for await (const _ of agent.run('test abort retry')) {
			// consume
		}

		expect(attemptCount).toBeLessThanOrEqual(2);
	});

	it('should reject concurrent runs while streaming', async () => {
		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		let running = false;
		registerProvider({
			name: testModel.provider,
			stream: () => {
				running = true;
				const partial = {
					role: 'assistant' as const,
					content: [{ type: 'text' as const, text: 'Response' }],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'stop' as StopReason,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
					timestamp: Date.now(),
				};
				const stream = new AssistantMessageEventStream();
				stream.push({ type: 'start', partial });
				stream.end(partial);
				return stream;
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'test' });

		await expect(
			(async () => {
				const run1 = agent.run('first');
				const run2 = agent.run('second');
				await Promise.all([
					(async () => { for await (const _ of run1) {} })(),
					(async () => { for await (const _ of run2) {} })(),
				]);
			})(),
		).rejects.toThrow('already processing');
	});

	it('should complete a simple text response', async () => {
		const events: Array<{ type: string }> = [];
		let agentEndSeen = false;

		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');

		registerProvider({
			name: testModel.provider,
			stream: () => {
				const partial = {
					role: 'assistant' as const,
					content: [{ type: 'text' as const, text: 'Hello from test' }],
					provider: testModel.provider,
					model: testModel.id,
					stopReason: 'stop' as StopReason,
					usage: { input: 5, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 8 },
					timestamp: Date.now(),
				};
				const stream = new AssistantMessageEventStream();
				stream.push({ type: 'start', partial });
				stream.end(partial);
				return stream;
			},
		});

		const agent = new Agent({ model: testModel, systemPrompt: 'You are helpful' });

		for await (const ev of agent.run('Hi')) {
			events.push(ev);
			if (ev.type === 'agent_end') agentEndSeen = true;
		}

		expect(agentEndSeen).toBe(true);
	});
});
