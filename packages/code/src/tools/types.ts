import type { z } from 'zod';
import type { ToolResult, ToolUpdateCallback } from '@mohanscodex/spectra-agent';
import type { ToolCapabilities } from '../security/types.js';

export interface ToolStreamingDisplay {
	/** Render partially generated arguments while the model emits the tool call. */
	arguments?: boolean;
	/** Render partial results emitted while the tool executes. */
	output?: boolean;
}

export interface SpectraTool<TArgs extends z.ZodType = z.ZodType> {
	name: string;
	description: string;
	displayName?: string | ((args: z.infer<TArgs>, result: ToolResult) => string);
	parameters: TArgs;
	promptGuidelines?: string[];
	capabilities?: ToolCapabilities;
	streaming?: ToolStreamingDisplay;
	execute: (args: z.infer<TArgs>, context: ToolContext) => Promise<ToolResult>;
}

export type ToolContext = {
	toolCallId: string;
	signal?: AbortSignal;
	onUpdate?: ToolUpdateCallback;
};
