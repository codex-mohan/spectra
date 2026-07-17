import { describe, expect, it } from 'vitest';
import { captureTurnConfiguration, latestTurnConfiguration, readTurnConfiguration } from '../tui/turn-config.js';

describe('turn configuration capture', () => {
	it('uses synchronous current values rather than a prior render snapshot', () => {
		const agent = { current: 'debug' };
		const model = { current: 'model-debug' as string | null };
		const provider = { current: 'provider-debug' as string | null };
		const thinkingEffort = { current: 'low' as string | undefined };

		agent.current = 'build';
		model.current = 'model-build';
		provider.current = 'provider-build';
		thinkingEffort.current = 'high';

		expect(captureTurnConfiguration({ agent, model, provider, thinkingEffort })).toEqual({
			agent: 'build',
			model: 'model-build',
			provider: 'provider-build',
			thinkingEffort: 'high',
		});
	});

	it('derives the active configuration from complete persisted user-turn provenance', () => {
		const messages = [
			{ role: 'user' as const, content: 'debug task', metadata: { agent: 'debug', model: 'model-debug', provider: 'test' }, timestamp: 1 },
			{ role: 'assistant' as const, content: [], provider: 'test', model: 'model-debug', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 }, stopReason: 'stop' as const, timestamp: 2 },
			{ role: 'user' as const, content: 'build task', metadata: { agent: 'build', model: 'model-build', provider: 'test', thinkingEffort: 'high' }, timestamp: 3 },
		];

		expect(latestTurnConfiguration(messages)).toEqual({ agent: 'build', model: 'model-build', provider: 'test', thinkingEffort: 'high' });
	});

	it('uses persisted user-message provenance as the runtime configuration', () => {
		const message = {
			role: 'user' as const,
			content: 'Review this design',
			timestamp: 1,
			metadata: { agent: 'plan', model: 'claude-sonnet', provider: 'anthropic', thinkingEffort: 'high' },
		};

		expect(readTurnConfiguration(message)).toEqual({
			agent: 'plan',
			model: 'claude-sonnet',
			provider: 'anthropic',
			thinkingEffort: 'high',
		});
	});

	it('rejects user messages without complete turn provenance', () => {
		expect(() => readTurnConfiguration({
			role: 'user',
			content: 'Old message',
			timestamp: 1,
			metadata: { agent: 'plan', model: 'claude-sonnet' },
		})).toThrow('missing turn configuration provenance');
	});
});
