import { z } from "zod";
import type { SpectraTool } from "./types.js";
import { textResult, errorResult } from "./utils.js";
import { AGENT_DEFINITIONS, SUBAGENTS, filterToolsByAgent } from "../agents/definitions.js";
import { AgentRegistry } from "../agents/registry.js";
import type { AgentTool } from "@singularity-ai/spectra-agent";

function descriptionForTaskTool(): string {
  const subagentList = SUBAGENTS.map((name) => {
    const def = AGENT_DEFINITIONS[name];
    return `- **${name}**: ${def.description}`;
  }).join("\n");

  return `Launch a new agent to handle complex, multistep tasks autonomously.

When to use the Task tool:
${subagentList}

Usage notes:
1. Launch multiple agents concurrently whenever possible, to maximize performance
2. Each agent invocation starts with a fresh context
3. The agent's outputs should generally be trusted
4. Clearly tell the agent whether you expect it to write code or just to do research`;
}

export const taskTool: SpectraTool = {
  name: "task",
  description: descriptionForTaskTool(),
  displayName: (args: { description: string }) =>
    `@${(args as any).subagent_type || "subagent"} ${args.description || ""}`.slice(0, 60),
  parameters: z.object({
    description: z.string().describe("A short (3-5 words) description of the task"),
    prompt: z.string().describe("The task for the agent to perform"),
    subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  }),

  execute: async ({ description, prompt, subagent_type }, ctx) => {
    const def = AGENT_DEFINITIONS[subagent_type];
    if (!def) {
      const available = SUBAGENTS.join(", ");
      return errorResult(`Unknown subagent "${subagent_type}". Available: ${available}`);
    }
    if (def.mode !== "subagent") {
      return errorResult(`"${subagent_type}" is a primary agent, not a subagent. Available subagents: ${SUBAGENTS.join(", ")}`);
    }

    const config = AgentRegistry.getConfig();
    if (!config) {
      return errorResult("Task tool: no agent config available");
    }

    try {
      const { Agent } = await import("@singularity-ai/spectra-agent");
      const { createAllTools, spectraToolToAgentTool } = await import("./index.js");
      const allTools = createAllTools().map(spectraToolToAgentTool);
      const tools = filterToolsByAgent(allTools, subagent_type);

      const subagent = new Agent({
        model: config.model,
        systemPrompt: def.prompt,
        tools,
        maxTurns: def.maxTurns,
        getApiKey: config.getApiKey,
      });

      const outputParts: string[] = [];
      for await (const ev of subagent.run(prompt)) {
        if (ev.type === "message_update" && ev.message.role === "assistant") {
          const textBlocks = ev.message.content.filter(
            (c): c is { type: "text"; text: string } => c.type === "text"
          );
          for (const block of textBlocks) {
            if (block.text) outputParts.push(block.text);
          }
        }
      }

      const resultText = outputParts.join("").trim();
      if (!resultText) {
        return textResult(`Subagent @${subagent_type} completed with no text output.`);
      }
      return textResult(resultText);
    } catch (err) {
      return errorResult(
        `Subagent @${subagent_type} failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  },
};
