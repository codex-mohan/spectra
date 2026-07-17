import { describe, expect, it } from 'vitest';
import { AssistantMessageEventStream, registerProvider } from '@mohanscodex/spectra-ai';
import type { AssistantMessage, Context, ContextMessage, Model } from '@mohanscodex/spectra-ai';
import { Agent } from '../agent.js';
import { defineTool } from '../define-tool.js';
import { z } from 'zod';

const provider = 'agent-runtime-config-test';

const model = (id: string): Model => ({
	id,
	name: id,
	provider,
	api: provider,
});

function response(modelId: string, content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason'] = 'stop'): AssistantMessage {
	return {
		role: 'assistant',
		content,
		provider,
		model: modelId,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
		stopReason,
		timestamp: Date.now(),
	};
}

function completedStream(message: AssistantMessage): AssistantMessageEventStream {
	const events = new AssistantMessageEventStream();
	queueMicrotask(() => {
		events.push({ type: 'start', partial: message });
		events.push({ type: 'done', reason: message.stopReason, message });
		events.end(message);
	});
	return events;
}

describe('Agent runtime configuration', () => {
	it('replaces model, prompt, tools, limits, and stream options without discarding history', async () => {
		const seen: Array<{ model: string; context: Context; options: Record<string, unknown> }> = [];
		registerProvider({
			name: provider,
			stream(currentModel, context, options) {
				seen.push({ model: currentModel.id, context, options: options as Record<string, unknown> });
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});

		const oldTool = defineTool({
			name: 'old_tool',
			description: 'old',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text' as const, text: 'old' }] }),
		});
		const newTool = defineTool({
			name: 'new_tool',
			description: 'new',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text' as const, text: 'new' }] }),
		});

		const agent = new Agent({
			model: model('first'),
			systemPrompt: 'first prompt',
			tools: [oldTool],
			maxTurns: 1,
			streamOptions: { temperature: 0.1 },
		});

		for await (const _event of agent.run('first turn')) {
		}

		agent.configure({
			model: model('second'),
			systemPrompt: 'second prompt',
			tools: [newTool],
			streamOptions: { temperature: 0.9 },
		});

		for await (const _event of agent.run('second turn')) {
		}

		expect(agent.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
			'first turn',
			'second turn',
		]);
		expect(seen).toHaveLength(2);
		expect(seen[1]).toMatchObject({ model: 'second', context: { systemPrompt: 'second prompt' } });
		expect(seen[1]?.context.tools?.map((tool) => tool.name)).toEqual(['new_tool']);
		expect(seen[1]?.options.temperature).toBe(0.9);
	});

	it('applies build, plan, and rebuilt build prompts on consecutive turns', async () => {
		const seenPrompts: Array<string | readonly string[] | undefined> = [];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenPrompts.push(context.systemPrompt);
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});

		const agent = new Agent({ model: model('mode-switch'), systemPrompt: 'build prompt' });
		for await (const _event of agent.run('hello')) {
		}

		agent.configure({ model: model('mode-switch'), systemPrompt: 'plan prompt' });
		for await (const _event of agent.run('plan the fix')) {
		}

		agent.configure({ model: model('mode-switch'), systemPrompt: 'build prompt' });
		for await (const _event of agent.run('proceed')) {
		}

		expect(seenPrompts).toEqual(['build prompt', 'plan prompt', 'build prompt']);
		expect(agent.messages.filter((message) => message.role === 'user').map((message) => message.content)).toEqual([
			'hello',
			'plan the fix',
			'proceed',
		]);
	});

	it('rejects runtime configuration while streaming', async () => {
		let configureError: unknown;
		registerProvider({
			name: provider,
			stream(currentModel) {
				try {
					agent.configure({ model: model('replacement') });
				} catch (error) {
					configureError = error;
				}
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});

		const agent = new Agent({ model: model('streaming') });
		for await (const _event of agent.run('run')) {
		}

		expect(configureError).toBeInstanceOf(Error);
		expect((configureError as Error).message).toContain('Cannot configure');
	});

	it('prepares ephemeral messages for each model iteration without mutating history', async () => {
		let call = 0;
		const seenRuntimeMessages: string[][] = [];
		const preparedIterations: number[] = [];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenRuntimeMessages.push(context.messages.flatMap((message) => typeof message.content === 'string' ? [message.content] : []));
				const message = call++ === 0
					? response(currentModel.id, [{ type: 'toolCall', id: 'tool-call', name: 'echo', arguments: {} }], 'toolUse')
					: response(currentModel.id, [{ type: 'text', text: 'done' }]);
				return completedStream(message);
			},
		});
		const echo = defineTool({
			name: 'echo',
			description: 'echo',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
		});
		const agent = new Agent({
			model: model('dynamic'),
			systemPrompt: 'stable',
			tools: [echo],
			beforeModelCall: async (context) => {
				preparedIterations.push(context.iteration);
				return { messages: [...context.messages, { role: 'user', content: `iteration=${context.iteration}`, timestamp: Date.now() }] };
			},
		});

		for await (const _event of agent.run('run')) {
		}

		expect(preparedIterations).toEqual([1, 2]);
		expect(seenRuntimeMessages).toEqual([['run', 'iteration=1'], ['run', 'iteration=2']]);
		expect(agent.messages.some((message) => typeof message.content === 'string' && message.content.includes('iteration='))).toBe(false);
	});

	it('isolates canonical history from context-array mutation', async () => {
		registerProvider({
			name: provider,
			stream(currentModel) {
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('defensive-copy'),
			transformContext: async (messages) => {
				messages.push({ role: 'user', content: 'ephemeral mutation', timestamp: Date.now() });
				return messages;
			},
		});

		for await (const _event of agent.run('real input')) {
		}

		expect(agent.messages.some((message) => message.role === 'user' && message.content === 'ephemeral mutation')).toBe(false);
	});


	it('keeps beforeModelCall message injection out of canonical history', async () => {
		let requestRoles: string[] = [];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				requestRoles = context.messages.map((message) => message.role);
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('ephemeral-message'),
			beforeModelCall: async (context) => ({
				messages: [
					...context.messages,
					{ role: 'user', content: 'runtime-only message', timestamp: Date.now() },
				],
			}),
		});

		for await (const _event of agent.run('real input')) {
		}

		expect(requestRoles).toEqual(['user', 'user']);
		expect(agent.messages.some((message) => message.role === 'user' && message.content === 'runtime-only message')).toBe(false);
	});

	it('preserves listeners and queued input across configuration', async () => {
		const userMessages: string[] = [];
		registerProvider({
			name: provider,
			stream(currentModel) {
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({ model: model('before') });
		agent.subscribe((event) => {
			if (event.type === 'message_end' && event.message.role === 'user') {
				userMessages.push(String(event.message.content));
			}
		});
		agent.steer('queued input');
		agent.configure({ model: model('after'), systemPrompt: 'after prompt' });

		for await (const _event of agent.run('initial input')) {
		}

		expect(userMessages).toEqual(['initial input', 'queued input']);
	});
	it('does not reprepare context for a transport retry', async () => {
		let attempts = 0;
		let preparations = 0;
		registerProvider({
			name: provider,
			stream(currentModel) {
				attempts++;
				if (attempts === 1) {
					throw Object.assign(new Error('temporary failure'), { status: 500 });
				}
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('retry'),
			beforeModelCall: async (context) => {
				preparations++;
				return { messages: [...context.messages] };
			},
			maxRetryDelayMs: 0,
		});

		for await (const _event of agent.run('run')) {
		}

		expect(attempts).toBe(2);
		expect(preparations).toBe(1);
	});

	it('aborts the request and emits an audit event when context preparation fails', async () => {
		let providerCalled = false;
		registerProvider({
			name: provider,
			stream() {
				providerCalled = true;
				return completedStream(response('unexpected', [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('hook-error'),
			beforeModelCall: async () => {
				throw new Error('context unavailable');
			},
		});
		const audits: Array<{ eventType: string; details: Record<string, unknown> }> = [];

		for await (const event of agent.run('run')) {
			if (event.type === 'audit') audits.push({ eventType: event.eventType, details: event.details });
		}

		expect(providerCalled).toBe(false);
		expect(agent.errorMessage).toBe('context unavailable');
		expect(audits).toContainEqual(expect.objectContaining({
			eventType: 'hook_error',
			details: expect.objectContaining({ hook: 'beforeModelCall', fallbackBehavior: 'aborted' }),
		}));
	});

	it('preserves provider failure metadata and ends the turn as an error', async () => {
		registerProvider({
			name: provider,
			stream(currentModel) {
				const events = new AssistantMessageEventStream();
				const failure = {
					...response(currentModel.id, []),
					stopReason: 'error' as const,
					errorMessage: 'Request timed out',
					metadata: { error: { kind: 'timeout', message: 'Request timed out', retryable: true, statusCode: 504 } },
				};
				queueMicrotask(() => {
					events.push({ type: 'start', partial: failure });
					events.push({ type: 'error', reason: 'error', error: failure });
					events.end();
				});
				return events;
			},
		});
		const agent = new Agent({ model: model('failure') });

		for await (const _event of agent.run('run')) {
		}

		const failure = agent.messages.at(-1) as AssistantMessage;
		expect(agent.errorMessage).toBe('Request timed out');
		expect(failure.metadata?.error).toMatchObject({ kind: 'timeout', statusCode: 504 });
	});
});

describe('contextMessages', () => {
	it('reaches the provider on each model iteration including tool loops', async () => {
		let call = 0;
		const seenContextMessages: (readonly ContextMessage[] | undefined)[] = [];
		const ctx: ContextMessage[] = [{ role: 'developer', content: 'global instructions' }];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenContextMessages.push(context.contextMessages);
				const message = call++ === 0
					? response(currentModel.id, [{ type: 'toolCall', id: 'tc-1', name: 'echo', arguments: {} }], 'toolUse')
					: response(currentModel.id, [{ type: 'text', text: 'done' }]);
				return completedStream(message);
			},
		});
		const echo = defineTool({
			name: 'echo',
			description: 'echo',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
		});
		const agent = new Agent({
			model: model('ctx-loop'),
			tools: [echo],
			contextMessages: ctx,
		});

		for await (const _event of agent.run('go')) {}

		expect(seenContextMessages).toHaveLength(2);
		expect(seenContextMessages[0]).toEqual(ctx);
		expect(seenContextMessages[1]).toEqual(ctx);
	});

	it('beforeModelCall hook contextMessages are iteration-local and do not persist', async () => {
		const original: ContextMessage[] = [{ role: 'developer', content: 'original' }];
		const replaced: ContextMessage[] = [{ role: 'developer', content: 'replaced this iteration only' }];
		let call = 0;
		const seenContextMessages: (readonly ContextMessage[] | undefined)[] = [];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenContextMessages.push(context.contextMessages);
				const message = call++ === 0
					? response(currentModel.id, [{ type: 'toolCall', id: 'tc-1', name: 'echo', arguments: {} }], 'toolUse')
					: response(currentModel.id, [{ type: 'text', text: 'done' }]);
				return completedStream(message);
			},
		});
		const echo = defineTool({
			name: 'echo',
			description: 'echo',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
		});
		const agent = new Agent({
			model: model('hook-local'),
			tools: [echo],
			contextMessages: original,
			beforeModelCall: async (ctx) => {
				// Replace only on the first iteration; return undefined on the second
				if (ctx.iteration === 1) return { contextMessages: replaced };
				return undefined;
			},
		});

		for await (const _event of agent.run('go')) {}

		// Iteration 1: hook replaced contextMessages
		expect(seenContextMessages).toHaveLength(2);
		expect(seenContextMessages[0]).toEqual(replaced);
		// Iteration 2: hook returned undefined, configured contextMessages restored
		expect(seenContextMessages[1]).toEqual(original);
		// Hook's replacement did not mutate the configured array
		expect(original).toEqual([{ role: 'developer', content: 'original' }]);
	});

	it('configure replaces contextMessages atomically between turns', async () => {
		const first: ContextMessage[] = [{ role: 'developer', content: 'first' }];
		const second: ContextMessage[] = [{ role: 'developer', content: 'second' }];
		let call = 0;
		const seenContextMessages: (readonly ContextMessage[] | undefined)[] = [];
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenContextMessages.push(context.contextMessages);
				const msg = call++ === 0
					? response(currentModel.id, [{ type: 'text', text: 'waiting' }])
					: response(currentModel.id, [{ type: 'text', text: 'done' }]);
				return completedStream(msg);
			},
		});
		const agent = new Agent({
			model: model('configure-replace'),
			contextMessages: first,
		});

		// First turn uses initial contextMessages
		for await (const _event of agent.run('turn 1')) {}
		// Replace between turns
		agent.configure({ model: model('configure-replace'), contextMessages: second });
		// Second turn uses replacement
		for await (const _event of agent.run('turn 2')) {}

		expect(seenContextMessages).toHaveLength(2);
		expect(seenContextMessages[0]).toEqual(first);
		expect(seenContextMessages[1]).toEqual(second);
	});

	it('never appears in agent.messages (canonical history)', async () => {
		const ctx: ContextMessage[] = [{ role: 'developer', content: 'secret context' }];
		registerProvider({
			name: provider,
			stream(currentModel) {
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('no-leak'),
			contextMessages: ctx,
		});

		for await (const _event of agent.run('hello')) {}

		// No message in canonical history should contain context content
		const leaked = agent.messages.some(
			(m) => typeof m.content === 'string' && m.content.includes('secret context'),
		);
		expect(leaked).toBe(false);
		// Context messages have role 'developer'; no message in history has that role
		const hasDeveloperRole = agent.messages.some((m) => (m as any).role === 'developer');
		expect(hasDeveloperRole).toBe(false);
	});
	it('defensively deep-copies configured contextMessages so caller mutation is invisible', async () => {
		const original: ContextMessage[] = [{ role: 'developer', content: 'original' }];
		let seenByProvider: readonly ContextMessage[] | undefined;
		registerProvider({
			name: provider,
			stream(currentModel, context) {
				seenByProvider = context.contextMessages;
				return completedStream(response(currentModel.id, [{ type: 'text', text: 'done' }]));
			},
		});
		const agent = new Agent({
			model: model('mutation-guard'),
			contextMessages: original,
		});

		// Mutate the original array and its objects after construction
		original.push({ role: 'developer', content: 'injected' });
		(original[0] as any).content = 'tampered';

		for await (const _event of agent.run('go')) {}

		// Provider must see the original snapshot, not the mutated values
		expect(seenByProvider).toEqual([{ role: 'developer', content: 'original' }]);
		expect(seenByProvider).toHaveLength(1);
	});

});
