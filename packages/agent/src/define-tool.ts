import type { TextContent, ImageContent } from "@spectra/ai";
import type { AgentTool, ToolResult, ToolUpdateCallback } from "./types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export function defineTool<T extends z.ZodType>(
  schema: {
    name: string;
    description: string;
    parameters: T;
    execute: (
      args: z.infer<T>,
      context: {
        toolCallId: string;
        signal?: AbortSignal;
        onUpdate?: ToolUpdateCallback;
      },
    ) => Promise<ToolResult>;
  },
): AgentTool {
  const jsonSchema = zodToJsonSchema(schema.parameters, {
    target: "openApi3",
  }) as Record<string, unknown>;

  return {
    name: schema.name,
    description: schema.description,
    parameters: jsonSchema,
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
      onUpdate?: ToolUpdateCallback,
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
