# Multi-Agent Research

An orchestrator delegates research tasks to specialist agents in parallel.

## What It Does

A planner breaks down a research question, workers research each sub-topic in parallel, and a synthesizer combines the findings.

## Prerequisites

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent @singularity-ai/spectra-app
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

## Full Code

```typescript
import { AgentRegistry } from "@singularity-ai/spectra-app";

const orchestrator = new AgentRegistry();

// Register specialist agents
orchestrator.registerAgent("planner", {
  model: { id: "gpt-4o", name: "GPT-4o", provider: "openai", api: "openai-completions" },
  systemPrompt: "You are a research planner. Break down complex questions into 3-5 specific research sub-questions. Return them as a numbered list.",
});

orchestrator.registerAgent("researcher", {
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a research specialist. Provide detailed, factual answers with explanations. If you're uncertain, say so.",
});

orchestrator.registerAgent("synthesizer", {
  model: { id: "claude-sonnet-4-20250514", name: "Claude", provider: "anthropic", api: "anthropic-messages" },
  systemPrompt: "You are a research synthesizer. Combine multiple research findings into a coherent summary. Highlight areas of agreement and disagreement.",
});

async function research(topic: string) {
  console.log(`📋 Planning research on: ${topic}\n`);

  // Step 1: Plan
  const plan = await orchestrator.delegate("planner",
    `Break down this research question into sub-questions: "${topic}"`
  );
  console.log(`📝 Plan:\n${plan.result}\n`);

  // Step 2: Research in parallel
  const subQuestions = plan.result.split(/\d+\./).filter(s => s.trim());
  console.log(`🔍 Researching ${subQuestions.length} sub-questions in parallel...\n`);

  const results = await orchestrator.executeParallel(
    subQuestions.map(q => ({
      agentType: "researcher",
      task: q.trim(),
      budget: { maxTurns: 3, maxTokens: 5000 },
    }))
  );

  for (const r of results) {
    console.log(`  [${r.success ? "✅" : "❌"}] ${r.result.slice(0, 100)}...\n`);
  }

  // Step 3: Synthesize
  console.log("📊 Synthesizing findings...\n");
  const summary = await orchestrator.delegate("synthesizer",
    `Synthesize these research findings into a summary:\n${results.map(r => r.result).join("\n\n---\n\n")}`
  );

  console.log(`\n📄 Summary:\n${summary.result}`);
}

await research("Compare the environmental impact of electric vehicles vs gasoline vehicles");
```

## How It Works

1. **Planner** (GPT-4o) breaks the question into sub-questions
2. **Researchers** (Claude) work on each sub-question in parallel
3. **Synthesizer** (Claude) combines findings into a summary

## Customization

- Add a `fact_checker` agent to verify claims
- Add a `writer` agent to format the final output
- Use different models for different specialists

## Next Steps

- [**Multi-Agent Patterns Guide**](/guides/multi-agent-patterns) — Delegation strategies
- [**Orchestration Reference**](/typescript/orchestration) — AgentRegistry API
