import type { TextContent, ImageContent } from "@singularity-ai/spectra-ai";
import type { AgentTool, ToolResult, ToolUpdateCallback } from "./types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function defineTool<T extends z.ZodType, TDetails = unknown>(
  schema: {
    name: string;
    label?: string;
    description: string;
    parameters: T;
    promptGuidelines?: string[];
    execute: (
      args: z.infer<T>,
      context: {
        toolCallId: string;
        signal?: AbortSignal;
        onUpdate?: ToolUpdateCallback<TDetails>;
      },
    ) => Promise<ToolResult<TDetails>>;
  },
): AgentTool<TDetails> {
  const jsonSchema = zodToJsonSchema(schema.parameters, {
    target: "openApi3",
  }) as Record<string, unknown>;

  return {
    name: schema.name,
    label: schema.label,
    description: schema.description,
    parameters: jsonSchema,
    promptGuidelines: schema.promptGuidelines,
    prepareArguments: (args: unknown): Record<string, unknown> => {
      const result = schema.parameters.safeParse(args);
      if (!result.success) {
        throw new Error(
          `Invalid arguments for tool "${schema.name}": ${result.error.message}`,
        );
      }
      return result.data as Record<string, unknown>;
    },
    execute: async (
      toolCallId: string,
      args: Record<string, unknown>,
      signal?: AbortSignal,
      onUpdate?: ToolUpdateCallback<TDetails>,
    ) => {
      return schema.execute(args as z.infer<T>, {
        toolCallId,
        signal,
        onUpdate,
      });
    },
  };
}

export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text } as TextContent] };
}

export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: message } as TextContent],
    isError: true,
  };
}
