// spectra-ts example - run with: npx tsx examples/basic.ts
import { Agent, defineTool, getModel, anthropic, openai } from "../src/index.js";
import { z } from "zod";

// Example: Define tools with Zod validation
const readTool = defineTool({
  name: "read",
  description: "Read contents of a file",
  schema: z.object({
    path: z.string().describe("Path to the file to read"),
  }),
  execute: async ({ path }) => {
    // In real implementation, this would call native addon
    return { content: `Contents of ${path}...` };
  },
});

const writeTool = defineTool({
  name: "write",
  description: "Write content to a file",
  schema: z.object({
    path: z.string().describe("Path to write to"),
    content: z.string().describe("Content to write"),
  }),
  execute: async ({ path, content }) => {
    // In real implementation, this would call native addon
    return { success: true, path };
  },
});

async function main() {
  console.log("=== Spectra TypeScript SDK Example ===\n");

  // Create models
  console.log("=== Models ===");
  const model1 = getModel("anthropic", "claude-sonnet-4-5", { maxTokens: 4096 });
  console.log(`  Model: ${model1.provider}/${model1.id}`);

  const model2 = anthropic("claude-haiku-3-5", { temperature: 0.7 });
  console.log(`  Model (factory): ${model2.provider}/${model2.id}`);

  const model3 = openai("gpt-4o");
  console.log(`  Model (factory): ${model3.provider}/${model3.id}`);

  // Create agent config
  console.log("\n=== Agent Config ===");
  const config = {
    model: model1,
    systemPrompt: "You are a helpful coding assistant.",
    tools: [readTool, writeTool],
  };
  console.log(`  Model: ${config.model.id}`);
  console.log(`  System prompt: ${config.systemPrompt}`);
  console.log(`  Tools: ${config.tools.map(t => t.name).join(", ")}`);

  // Create agent
  console.log("\n=== Agent ===");
  const agent = new Agent(config);
  console.log("  Agent created successfully!");

  // Note about native binding
  console.log("\n=== Native Binding ===");
  console.log("  Note: agent.prompt() is stubbed pending napi-rs implementation");
  console.log("  Native addon needs to be compiled from crates/spectra-napi");

  // Test tool schema validation
  console.log("\n=== Tool Schema Validation ===");
  try {
    const validInput = { path: "/tmp/test.txt" };
    const result = await readTool.execute(validInput);
    console.log("  Valid input accepted:", result);
  } catch (e) {
    console.error("  Error:", e);
  }

  console.log("\n=== Example complete ===");
}

main().catch(console.error);
