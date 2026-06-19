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
	id: string;
	role: 'user' | 'assistant' | 'tool' | 'error';
	content: string;
	blocks?: ContentBlock[];
	meta?: string;
	streaming?: boolean;
	model?: string;
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
	/** Agent that generated this message */
	agent?: string;
}
