export type AgentMode = 'primary' | 'subagent' | 'all';

export type AgentThinkingLevel =
	| 'off'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh'
	| 'max';

/** Structured handoff schema (Pi-compatible subset). Opaque JSON-compatible tree. */
export type AgentOutputSchema = Record<string, unknown>;

export interface AgentDefinition {
	name: string;
	mode: AgentMode;
	description: string;
	/**
	 * Claude allowlist. When set, only these tools (minus disallowedTools) are available.
	 * When omitted, inherit all tools then apply disallowedTools.
	 */
	tools?: string[];
	/**
	 * Claude denylist. Removed from the allowlist or from the full tool pool.
	 */
	disallowedTools?: string[];
	maxTurns?: number;
	temperature?: number;
	prompt: string;
	reporting?: string;
	hidden?: boolean;
	/** Prompt-bar left accent color: hex (`#RRGGBB`) or named token (red, blue, …). */
	color?: string;
	model?: { id: string; provider: string };
	/** Per-agent thinking effort (Pi + Spectra). Session UI may still override. */
	thinkingLevel?: AgentThinkingLevel;
	/** Structured output schema for handoff (Pi). */
	output?: AgentOutputSchema;
	/** Prefer summarized file reads when true (Pi explore-style). */
	readSummarize?: boolean;
	/** Absolute path when loaded from markdown. */
	source?: string;
}

export interface AgentDiagnostic {
	kind: 'parse' | 'validation';
	sourcePath: string;
	message: string;
}

export interface AgentCatalog {
	definitions: Record<string, AgentDefinition>;
	primary: string[];
	subagents: string[];
	diagnostics: AgentDiagnostic[];
}
