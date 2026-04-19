import { Agent } from "@spectra/agent";

// This is a placeholder example
// Providers will be implemented next

const agent = new Agent({
  model: { id: "claude-sonnet-4", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a helpful assistant.",
});

console.log("Agent created:", agent);
