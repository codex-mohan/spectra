import { describe, expect, it } from 'vitest';
import type { AssistantMessage, Model } from '@mohanscodex/spectra-ai';
import { Agent } from '../agent.js';
import { defineTool } from '../define-tool.js';
import { RepetitionDetector } from '../repetition.js';
import { z } from 'zod';

const testModel: Model = {
	id: 'safety-test-model',
	name: 'Safety Test Model',
	provider: 'safety-test',
	api: 'safety-test',
};

const UNIT = 'The quick brown fox jumps over the lazy dog. ';
const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

function partial(text: string): AssistantMessage {
	return {
		role: 'assistant',
		content: [{ type: 'text', text }],
		provider: testModel.provider,
		model: testModel.id,
		stopReason: 'stop',
		usage: USAGE,
		timestamp: Date.now(),
	};
}

describe('RepetitionDetector', () => {
	it('fires on four identical consecutive units', () => {
		const detector = new RepetitionDetector();
		let result = null;
		for (let index = 0; index < 4; index++) result = detector.push('text', UNIT);
		expect(result).toMatchObject({ kind: 'text', repeats: 4 });
	});

	it('does not fire on three repeats', () => {
		const detector = new RepetitionDetector();
		let result = null;
		for (let index = 0; index < 3; index++) result = detector.push('text', UNIT);
		expect(result).toBeNull();
	});

	it('ignores numeric and whitespace runs', () => {
		const detector = new RepetitionDetector();
		let result = null;
		for (let index = 0; index < 6; index++) result = detector.push('thinking', '0123456789 0123456789 0123456789 ');
		expect(result).toBeNull();
	});

	it('tracks text and thinking separately', () => {
		const detector = new RepetitionDetector();
		for (let index = 0; index < 3; index++) {
			expect(detector.push('text', UNIT)).toBeNull();
			expect(detector.push('thinking', UNIT)).toBeNull();
		}
		expect(detector.push('text', UNIT)).toMatchObject({ kind: 'text' });
	});
});

describe('Agent safety guards', () => {
	it('stops a repeated stream once and ends the turn with an error', async () => {
		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');
		let streams = 0;
		registerProvider({
			name: testModel.provider,
			stream: () => {
				streams++;
				const eventStream = new AssistantMessageEventStream();
				let text = '';
				eventStream.push({ type: 'start', partial: partial('') });
				for (let index = 0; index < 10; index++) {
					text += UNIT;
					eventStream.push({ type: 'text_delta', contentIndex: 0, delta: UNIT, partial: partial(text) });
				}
				eventStream.end(partial(text));
				return eventStream;
			},
		});

		const agent = new Agent({ model: testModel, safety: { repetition: { enabled: true } } });
		const events: Array<{ type: string; kind?: string; severity?: string }> = [];
		for await (const event of agent.run('go')) events.push(event as { type: string; kind?: string; severity?: string });

		const safety = events.filter((event) => event.type === 'safety');
		expect(safety).toHaveLength(1);
		expect(safety[0]).toMatchObject({ kind: 'repetition', severity: 'interrupt' });
		expect(streams).toBe(1);
		expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(1);
		expect(agent.errorMessage).toContain('Repetition loop detected');
	});

	it('warns without stopping when repetition is in warn mode', async () => {
		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');
		registerProvider({
			name: testModel.provider,
			stream: () => {
				const eventStream = new AssistantMessageEventStream();
				let text = '';
				eventStream.push({ type: 'start', partial: partial('') });
				for (let index = 0; index < 5; index++) {
					text += UNIT;
					eventStream.push({ type: 'text_delta', contentIndex: 0, delta: UNIT, partial: partial(text) });
				}
				eventStream.push({ type: 'text_end', contentIndex: 0, content: text, partial: partial(text) });
				eventStream.push({ type: 'done', reason: 'stop', message: partial(text) });
				return eventStream;
			},
		});

		const agent = new Agent({ model: testModel, safety: { repetition: 'warn' } });
		const safety = [];
		for await (const event of agent.run('go')) {
			if (event.type === 'safety') safety.push(event);
		}
		expect(safety).toHaveLength(1);
		expect(safety[0].severity).toBe('warning');
		expect(agent.errorMessage).toBeUndefined();
	});

	it('emits an output bloat warning after a large tool result', async () => {
		const { registerProvider, AssistantMessageEventStream } = await import('@mohanscodex/spectra-ai');
		let call = 0;
		registerProvider({
			name: testModel.provider,
			stream: () => {
				call++;
				const eventStream = new AssistantMessageEventStream();
				if (call === 1) {
					const toolCall = { type: 'toolCall' as const, id: 'big-call', name: 'big_output', arguments: {} };
					const message = { ...partial(''), content: [toolCall], stopReason: 'toolUse' as const };
					eventStream.push({ type: 'start', partial: message });
					eventStream.push({ type: 'toolcall_start', contentIndex: 0, partial: message });
					eventStream.push({ type: 'toolcall_end', contentIndex: 0, toolCall, partial: message });
					eventStream.push({ type: 'done', reason: 'toolUse', message });
				} else {
					const message = partial('done');
					eventStream.push({ type: 'start', partial: message });
					eventStream.push({ type: 'text_delta', contentIndex: 0, delta: 'done', partial: message });
					eventStream.push({ type: 'done', reason: 'stop', message });
				}
				return eventStream;
			},
		});

		const tool = defineTool({
			name: 'big_output',
			description: 'big',
			parameters: z.object({}),
			execute: async () => ({ content: [{ type: 'text', text: 'x'.repeat(2_000) }] }),
		});
		const agent = new Agent({ model: testModel, tools: [tool], safety: { outputBloat: { warnBytes: 1_000 } } });
		const safety = [];
		for await (const event of agent.run('go')) {
			if (event.type === 'safety') safety.push(event);
		}
		expect(safety).toHaveLength(1);
		expect(safety[0]).toMatchObject({ kind: 'output_bloat', severity: 'warning' });
	});
});
