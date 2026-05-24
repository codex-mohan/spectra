import type { z } from "zod";
import type { ToolResult, ToolUpdateCallback } from "@mohanscodex/spectra-agent";

export interface SpectraTool<TArgs extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  displayName?: string | ((args: z.infer<TArgs>, result: ToolResult) => string);
  parameters: TArgs;
  promptGuidelines?: string[];
  execute: (
    args: z.infer<TArgs>,
    context: ToolContext,
  ) => Promise<ToolResult>;
}

export type ToolContext = {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: ToolUpdateCallback;
};
