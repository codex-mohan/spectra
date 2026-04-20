import { Agent } from "@spectra/agent";

const agent = new Agent({
  model: { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a helpful assistant.",
});

console.log("Agent created:", agent);
