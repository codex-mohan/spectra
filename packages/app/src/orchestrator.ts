import { Agent } from "@singularity-ai/spectra-agent";
import type { Budget, DelegationResult, TaskConfig } from "./types.js";

export class SimpleOrchestrator {
  private agents: Map<string, any> = new Map();

  registerAgent(agentType: string, config: any): void {
    this.agents.set(agentType, config);
  }

  async delegate(agentType: string, task: string, budget?: Budget): Promise<DelegationResult> {
    const agentConfig = this.agents.get(agentType);
    if (!agentConfig) {
      return {
        agentType,
        success: false,
        result: "",
        error: `Unknown agent type: ${agentType}`,
      };
    }

    try {
      const agent = new Agent({
        model: agentConfig.model,
        systemPrompt: agentConfig.systemPrompt,
        tools: agentConfig.tools,
      });

      const events: any[] = [];
      for await (const event of agent.run(task)) {
        events.push(event);
      }

      // Get final assistant message
      const assistantMessage = agent.messages.find((m: any) => m.role === "assistant");
      let result = "No response";
      if (assistantMessage?.content?.[0]) {
        const content = assistantMessage.content[0];
        result = typeof content === "string" ? content : (content as any).text ?? "No response";
      }

      return {
        agentType,
        success: true,
        result,
      };
    } catch (err) {
      return {
        agentType,
        success: false,
        result: "",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async executeParallel(tasks: TaskConfig[]): Promise<DelegationResult[]> {
    const promises = tasks.map((task) =>
      this.delegate(task.agentType, task.task, task.budget)
    );

    return Promise.all(promises);
  }
}
