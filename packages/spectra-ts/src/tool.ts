import type { ZodTypeAny } from "zod";
import { SchemaError } from "./errors.js";

export interface ToolDefinition<TInput extends ZodTypeAny = ZodTypeAny> {
  name: string;
  description: string;
  schema: TInput;
  execute(input: unknown): Promise<unknown>;
}

export function defineTool<TInput extends ZodTypeAny>(
  def: ToolDefinition<TInput>
): ToolDefinition<TInput> {
  return def;
}

export async function dispatchTool<TInput extends ZodTypeAny>(
  tool: ToolDefinition<TInput>,
  input: unknown
): Promise<unknown> {
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    throw new SchemaError(
      tool.name,
      parsed.error.message
    );
  }
  return tool.execute(parsed.data);
}
