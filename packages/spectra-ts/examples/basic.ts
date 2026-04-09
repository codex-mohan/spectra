// spectra-ts example - run with: npx tsx examples/basic.ts
import { Agent, defineTool, anthropic, openai, getNativeVersion, type ToolDefinition } from "../src/index.js";
import { z } from "zod";

// Example: Define tools with Zod validation
const readTool = defineTool(
  "read",
  "Read contents of a file",
  z.object({
    path: z.string().describe("Path to the file to read"),
  })
);

async function main() {
  console.log("=== Spectra TypeScript SDK Example ===\n");

  // Check native version
  console.log("=== Native Binding ===");
  try {
    const version = await getNativeVersion();
    console.log(`  Native version: ${version}`);
  } catch {
    console.log("  Native addon not loaded (API keys may be missing)");
  }

  // Create models
  console.log("\n=== Models ===");
  const model1 = anthropic("claude-sonnet-4-5", { maxTokens: 4096 });
  console.log(`  Model: ${model1.provider}/${model1.id}`);

  const model2 = openai("gpt-4o");
  console.log(`  Model: ${model2.provider}/${model2.id}`);

  // Create agent
  console.log("\n=== Agent ===");
  const agent = new Agent({
    model: model1,
    systemPrompt: "You are a helpful coding assistant.",
    tools: [readTool],
  });
  console.log("  Agent created successfully!");

  // Run agent (requires API key)
  console.log("\n=== Running Agent ===");
  console.log("  Use ANTHROPIC_API_KEY environment variable to enable LLM calls");
  console.log("  Example: ANTHROPIC_API_KEY=sk-... npx tsx examples/basic.ts");

  try {
    const events: string[] = [];
    for await (const event of agent.prompt("Hello, world!")) {
      events.push(event.type);
      console.log(`  Event: ${event.type}`);
    }
    console.log(`\n  Total events: ${events.length}`);
  } catch (e) {
    console.log(`  Error (expected without API key): ${e}`);
  }

  console.log("\n=== Example complete ===");
}

main().catch(console.error);
