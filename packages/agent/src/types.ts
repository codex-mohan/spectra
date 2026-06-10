import type {
	Message,
	AssistantMessage,
	AssistantMessageEvent,
	ToolCall,
	ToolResultMessage,
	TextContent,
	ImageContent,
	Model,
	Context,
} from '@mohanscodex/spectra-ai';

export type { Context } from '@mohanscodex/spectra-ai';

export interface AgentTool<TDetails = unknown> {
	name: string;
	label?: string;
	description: string;
	parameters: Record<string, unknown>;
	promptGuidelines?: string[];
	prepareArguments?: (args: unknown) => Record<string, unknown>;
	execute: (
		toolCallId: string,
		args: Record<string, unknown>,
		signal?: AbortSignal,
		onUpdate?: ToolUpdateCallback<TDetails>,
	) => Promise<ToolResult<TDetails>>;
}

export interface ToolResult<TDetails = unknown> {
	content: (TextContent | ImageContent)[];
	details?: TDetails;
	isError?: boolean;
}

export type ToolUpdateCallback<TDetails = unknown> = (partial: ToolResult<TDetails>) => void;

export type ToolExecutionMode = 'sequential' | 'parallel';

export interface BeforeToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: ToolCall;
	args: Record<string, unknown>;
	context: Context;
}

export interface AfterToolCallContext {
	assistantMessage: AssistantMessage;
	toolCall: ToolCall;
	args: Record<string, unknown>;
	result: ToolResult;
	isError: boolean;
	context: Context;
}

export interface BeforeToolCallResult {
	block?: boolean;
	reason?: string;
	transform?: {
		modifiedArgs: Record<string, unknown>;
	};
}

export interface AfterToolCallResult {
	content?: (TextContent | ImageContent)[];
	isError?: boolean;
}

export type AgentEvent =
	| { type: 'agent_start' }
	| { type: 'agent_end'; messages: Message[] }
	| { type: 'turn_start' }
	| { type: 'turn_end'; message: AssistantMessage; toolResults: ToolResultMessage[] }
	| { type: 'message_start'; message: Message }
	| { type: 'message_update'; message: AssistantMessage; assistantMessageEvent: AssistantMessageEvent }
	| { type: 'message_end'; message: Message }
	| { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: unknown }
	| { type: 'tool_execution_update'; toolCallId: string; toolName: string; args: unknown; partialResult: ToolResult }
	| { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean };

export type AgentEventListener = (event: AgentEvent, signal?: AbortSignal) => Promise<void> | void;

export interface AgentState {
	systemPrompt?: string;
	model: Model;
	messages: Message[];
	isStreaming: boolean;
	streamingMessage?: AssistantMessage;
	pendingToolCalls: ReadonlySet<string>;
	errorMessage?: string;
}

export interface RetryContext {
	error: Error;
	attempt: number;
	delay: number;
}

export interface RetryDecision {
	shouldRetry?: boolean;
	delay?: number;
}

export interface AgentConfig {
	model: Model;
	systemPrompt?: string;
	tools?: AgentTool[];
	maxTurns?: number;
	toolExecution?: ToolExecutionMode;
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
	transformContext?: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	onRetry?: (context: RetryContext) => RetryDecision | void;
}
