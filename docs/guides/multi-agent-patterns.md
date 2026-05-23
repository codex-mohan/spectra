# Multi-Agent Patterns

How to orchestrate multiple agents for complex tasks.

## Delegation Pattern

Use `AgentRegistry` to delegate tasks to specialist agents:

```typescript
import { AgentRegistry } from "@mohanscodex/spectra-app";

const orchestrator = new AgentRegistry();

orchestrator.registerAgent("researcher", {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are a research specialist. Provide detailed, cited answers.",
});

orchestrator.registerAgent("writer", {
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a writing specialist. Produce clear, engaging prose.",
});

// Delegate to a single agent
const research = await orchestrator.delegate("researcher", "Research quantum computing breakthroughs in 2025");

// Use the research to write an article
const article = await orchestrator.delegate("writer", `Write an article based on this research: ${research.result}`);
```

## Parallel Execution

Run multiple agents concurrently:

```typescript
const results = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Research quantum computing" },
  { agentType: "researcher", task: "Research AI safety" },
  { agentType: "researcher", task: "Research renewable energy" },
]);

for (const r of results) {
  console.log(`[${r.success ? "OK" : "FAIL"}] ${r.agentType}: ${r.result.slice(0, 100)}...`);
}
```

## Orchestrator-Worker Pattern

One agent plans, others execute:

```typescript
// Step 1: Planner breaks down the task
const plan = await orchestrator.delegate("planner",
  "Create a research plan for: 'Compare electric vs gas vehicles'"
);

// Step 2: Workers execute in parallel
const results = await orchestrator.executeParallel([
  { agentType: "researcher", task: "Research electric vehicle costs and performance" },
  { agentType: "researcher", task: "Research gas vehicle costs and performance" },
  { agentType: "researcher", task: "Research environmental impact of both" },
]);

// Step 3: Synthesizer combines results
const summary = await orchestrator.delegate("synthesizer",
  `Synthesize these research findings into a comparison: ${JSON.stringify(results)}`
);
```

## Budget Control

Limit agent resource usage:

```typescript
const result = await orchestrator.delegate("researcher", "Research X", {
  maxTurns: 5,
  maxTokens: 10000,
  timeoutMs: 60000,
});
```

## When to Use Multi-Agent

| Scenario | Pattern |
|---|---|
| Research + Writing | Delegation (researcher → writer) |
| Data gathering from multiple sources | Parallel execution |
| Complex analysis | Orchestrator-worker |
| A/B testing prompts | Parallel with different configs |

## Next Steps

- [**Orchestration Reference**](/typescript/orchestration) — AgentRegistry API
- [**Recipe: Multi-Agent Research**](/recipes/multi-agent-research) — Full working example
