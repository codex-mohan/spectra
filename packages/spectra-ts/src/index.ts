export { Agent } from "./agent.js";
export { defineTool, type ToolDefinition } from "./tool.js";
export { getModel, anthropic, openai, type Model, type ModelConfig, type Provider } from "./model.js";
export type { StreamEvent, StopReason, ContentDelta } from "./stream.js";
export { SpectraError, type ProviderError, type ToolError, type StreamError } from "./errors.js";

export type { AgentConfig } from "./agent.js";
