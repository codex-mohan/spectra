import { Agent } from './agent.js';
import type { Model, Message, AssistantMessage, Usage, StreamOptions } from '@mohanscodex/spectra-ai';
import type { AgentConfig, AgentEvent } from './types.js';

export interface SubagentBudget {
	maxTurns?: number;
	maxTokens?: number;
	timeoutMs?: number;
}

export interface SubagentConfig extends AgentConfig {
	modelOverride?: Model;
	budget?: SubagentBudget;
	signal?: AbortSignal;
	label?: string;
	onEvent?: (event: AgentEvent) => void;
	streamOptions?: StreamOptions;
	convertToLlm?: (messages: Message[]) => Message[] | Promise<Message[]>;
	maxRetryDelayMs?: number;
}

export interface SubagentResult {
	text: string;
	usage: Usage;
	messages: Message[];
	aborted: boolean;
	error?: string;
}

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
};

export async function runSubagent(config: SubagentConfig, prompt: string): Promise<SubagentResult> {
	const model = config.modelOverride ?? config.model;
	const budget = config.budget;

	const child = new Agent({
		model,
		systemPrompt: config.systemPrompt,
		tools: config.tools,
		maxTurns: budget?.maxTurns ?? config.maxTurns,
		toolExecution: config.toolExecution,
		beforeToolCall: config.beforeToolCall,
		afterToolCall: config.afterToolCall,
		transformContext: config.transformContext,
		getApiKey: config.getApiKey,
		onRetry: config.onRetry,
		streamOptions: config.streamOptions,
		convertToLlm: config.convertToLlm,
		maxRetryDelayMs: config.maxRetryDelayMs,
	});

	const controller = new AbortController();
	let aborted = false;

	if (config.signal) {
		if (config.signal.aborted) {
			aborted = true;
			controller.abort();
		} else {
			config.signal.addEventListener('abort', () => {
				aborted = true;
				controller.abort();
			}, { once: true });
		}
	}

	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	if (budget?.timeoutMs) {
		timeoutId = setTimeout(() => {
			aborted = true;
			controller.abort();
		}, budget.timeoutMs);
	}

	const usage: Usage = { ...ZERO_USAGE };
	let budgetExceeded = false;

	try {
		for await (const event of child.run(prompt, { signal: controller.signal })) {
			config.onEvent?.(event);

			if (event.type === 'message_end' && event.message.role === 'assistant') {
				const msg = event.message as AssistantMessage;
				if (msg.usage) {
					usage.input += msg.usage.input || 0;
					usage.output += msg.usage.output || 0;
					usage.cacheRead += msg.usage.cacheRead || 0;
					usage.cacheWrite += msg.usage.cacheWrite || 0;
					usage.totalTokens += msg.usage.totalTokens || 0;
					if (msg.usage.cost) {
						if (!usage.cost) {
							usage.cost = { ...msg.usage.cost };
						} else {
							usage.cost.input += msg.usage.cost.input || 0;
							usage.cost.output += msg.usage.cost.output || 0;
							usage.cost.cacheRead += msg.usage.cost.cacheRead || 0;
							usage.cost.cacheWrite += msg.usage.cost.cacheWrite || 0;
							usage.cost.total += msg.usage.cost.total || 0;
						}
					}
				}

				if (budget?.maxTokens && usage.totalTokens > budget.maxTokens) {
					budgetExceeded = true;
					controller.abort();
				}
			}
		}
	} catch (err) {
		if (!aborted && !budgetExceeded && !controller.signal.aborted) {
			return {
				text: '',
				usage,
				messages: child.messages,
				aborted: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	} finally {
		if (timeoutId) clearTimeout(timeoutId);
	}

	const text = extractFinalText(child.messages);
	const childError = detectError(child.messages);

	return {
		text,
		usage,
		messages: child.messages,
		aborted: aborted || budgetExceeded || controller.signal.aborted,
		error: budgetExceeded
			? `Budget exceeded: maxTokens (${budget?.maxTokens}) reached`
			: childError,
	};
}

function extractFinalText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === 'assistant') {
			const textBlocks = msg.content.filter(
				(c): c is { type: 'text'; text: string } => c.type === 'text',
			);
			return textBlocks.map((b) => b.text).join('');
		}
	}
	return '';
}

function detectError(messages: Message[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role === 'assistant' && (msg as AssistantMessage).stopReason === 'error') {
			return (msg as AssistantMessage).errorMessage ?? 'Unknown error';
		}
	}
	return undefined;
}
