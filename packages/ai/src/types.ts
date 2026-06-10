export interface TextContent {
	type: 'text';
	text: string;
}

export interface ThinkingContent {
	type: 'thinking';
	thinking: string;
	thinkingSignature?: string;
	redacted?: boolean;
}

export interface ImageContent {
	type: 'image';
	data: string;
	mimeType: string;
}

export interface ToolCall {
	type: 'toolCall';
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thinkingSignature?: string;
}

export type StopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export interface Usage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost?: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
}

export interface UserMessage {
	role: 'user';
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
	/** Arbitrary metadata for app/ui use. Ignored by LLM context. */
	metadata?: Record<string, unknown>;
}

export interface AssistantMessage {
	role: 'assistant';
	content: (TextContent | ThinkingContent | ToolCall)[];
	provider: string;
	model: string;
	responseId?: string;
	usage: Usage;
	stopReason: StopReason;
	errorMessage?: string;
	timestamp: number;
	/** Arbitrary metadata for app/ui use. Ignored by LLM context. */
	metadata?: Record<string, unknown>;
}

export interface ToolResultMessage<TDetails = unknown> {
	role: 'toolResult';
	toolCallId: string;
	toolName: string;
	content: (TextContent | ImageContent)[];
	/** Typed tool-specific metadata (e.g. diff, truncation info). Ignored by LLM context. */
	details?: TDetails;
	isError: boolean;
	timestamp: number;
	/** Arbitrary metadata for app/ui use. Ignored by LLM context. */
	metadata?: Record<string, unknown>;
	provenance?: {
		blockedBy?: string;
		blockReason?: string;
		transformedBy?: string;
		retryCount?: number;
		hookDetails?: Record<string, unknown>;
	};
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool {
	name: string;
	description: string;
	parameters: {
		type?: string;
		properties?: Record<string, unknown>;
		required?: string[];
		[key: string]: unknown;
	};
}

export interface Context {
	systemPrompt?: string;
	messages: Message[];
	tools?: Tool[];
}

export type AssistantMessageEvent =
	| { type: 'start'; partial: AssistantMessage }
	| { type: 'text_start'; contentIndex: number; partial: AssistantMessage }
	| { type: 'text_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: 'text_end'; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: 'thinking_start'; contentIndex: number; partial: AssistantMessage }
	| { type: 'thinking_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: 'thinking_end'; contentIndex: number; content: string; partial: AssistantMessage }
	| { type: 'toolcall_start'; contentIndex: number; partial: AssistantMessage }
	| { type: 'toolcall_delta'; contentIndex: number; delta: string; partial: AssistantMessage }
	| { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCall; partial: AssistantMessage }
	| { type: 'done'; reason: StopReason; message: AssistantMessage }
	| { type: 'error'; reason: StopReason; error: AssistantMessage };

export interface StreamOptions {
	signal?: AbortSignal;
	apiKey?: string;
	headers?: Record<string, string>;
	maxTokens?: number;
	temperature?: number;
	/** Thinking/reasoning effort level. Provider-dependent; common values: none, low, medium, high, max. */
	thinkingEffort?: string;
}

export interface Model {
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl?: string;
	reasoning?: boolean;
	maxTokens?: number;
	headers?: Record<string, string>;
}
