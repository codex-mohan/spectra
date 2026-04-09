export { Agent, createAgentFactory, getNativeVersion, listAgents } from "./agent.js";
export { defineTool, type ToolDefinition } from "./agent.js";
export { getModel, anthropic, openai, groq, type Model, type ModelConfig, type Provider } from "./model.js";
export type { StreamEvent, StopReason, ContentDelta } from "./stream.js";
export { SpectraError, type ProviderError, type ToolError, type StreamError } from "./errors.js";
export type { AgentConfig } from "./agent.js";
