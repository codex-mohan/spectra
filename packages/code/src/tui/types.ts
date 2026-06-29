import type { PromptAttachment } from './prompt-bar.js';

export type ContentBlock =
	| { type: 'text'; content: string }
	| { type: 'thinking'; content: string }
	| { type: 'toolCall'; name: string; args: string };

/** Patch: records which files changed during an agent turn and the pre-edit tree hash. */
export interface Patch {
	hash: string;
	files: string[];
}

export interface ChatMessage {
	/** Unique identifier for this message */
	id: string;
	/** The role of the message sender */
	role: 'user' | 'assistant' | 'tool' | 'error';
	content: string;
	/** Optional structured content blocks for the message */
	blocks?: ContentBlock[];
	/** Additional metadata for the message */
	meta?: string;
	/** Whether the message is being streamed */
	streaming?: boolean;
	/** The model used for this message */
	model?: string;
	/** Attachments for user messages */
	attachments?: PromptAttachment[];
	/** Turn status — set when the assistant turn completes/interrupts/errors */
	turnStatus?: 'completed' | 'interrupted' | 'error';
	/** Turn duration in milliseconds */
	turnDurationMs?: number;
	/** Token usage for this turn */
	turnTokens?: { input: number; output: number };
	/** Exit code for shell tool results (structured, no regex parsing needed) */
	exitCode?: number;
	/** Whether a tool result reported an error */
	toolError?: boolean;
	/** Shell tool wall time in milliseconds */
	wallTimeMs?: number;
	/** Shell tool timeout in milliseconds */
	timeoutMs?: number;
	/** Agent that generated this message */
	agent?: string;
	/** Child session id produced by a task tool call (for view switching) */
	childSessionId?: string;
	/** True when the task was spawned in the background (returns immediately) */
	background?: boolean;
}
