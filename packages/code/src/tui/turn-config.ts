import type { Message } from '@mohanscodex/spectra-ai';

export interface CurrentValue<T> {
	current: T;
}

export interface TurnConfiguration {
	agent: string;
	model: string | null;
	provider: string | null;
	thinkingEffort: string | undefined;
}

export interface PersistedTurnConfiguration {
	agent: string;
	model: string;
	provider: string;
	thinkingEffort: string | undefined;
}

export function captureTurnConfiguration(input: {
	agent: CurrentValue<string>;
	model: CurrentValue<string | null>;
	provider: CurrentValue<string | null>;
	thinkingEffort: CurrentValue<string | undefined>;
}): TurnConfiguration {
	return {
		agent: input.agent.current,
		model: input.model.current,
		provider: input.provider.current,
		thinkingEffort: input.thinkingEffort.current,
	};
}


export function latestTurnConfiguration(messages: readonly Message[]): PersistedTurnConfiguration | null {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message.role !== 'user') continue;
		try {
			return readTurnConfiguration(message);
		} catch {
			continue;
		}
	}
	return null;
}

export function readTurnConfiguration(message: Message): PersistedTurnConfiguration {
	if (message.role !== 'user') throw new Error('Turn configuration must come from a user message');
	const metadata = message.metadata;
	if (
		typeof metadata?.agent !== 'string' ||
		typeof metadata.model !== 'string' ||
		typeof metadata.provider !== 'string' ||
		(metadata.thinkingEffort !== undefined && typeof metadata.thinkingEffort !== 'string')
	) {
		throw new Error('User message is missing turn configuration provenance');
	}
	return {
		agent: metadata.agent,
		model: metadata.model,
		provider: metadata.provider,
		thinkingEffort: metadata.thinkingEffort,
	};
}

