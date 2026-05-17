# Prompt Engineering

How to write effective system prompts and tool descriptions for Spectra agents.

## System Prompt Patterns

### Role Definition

```typescript
const agent = new Agent({
  systemPrompt: `You are a research assistant specializing in scientific literature.
Your task is to:
1. Search for relevant papers
2. Summarize key findings
3. Cite sources with URLs
4. Note any conflicting evidence

Always be precise. If you're uncertain, say so rather than guessing.`,
});
```

### Constraints

```typescript
systemPrompt: `You are a coding assistant. Follow these rules:
- Always write complete, runnable code
- Include error handling
- Add comments explaining non-obvious logic
- Never use deprecated APIs
- Prefer standard library over third-party packages`,
```

### Few-Shot Examples

```typescript
systemPrompt: `You help users find restaurants. Here are examples of good responses:

User: "I want Italian food"
Assistant: I found several Italian restaurants nearby:
1. **Mario's** - 4.5★, $$, 0.3mi - Known for handmade pasta
2. **Luigi's** - 4.2★, $$$, 0.5mi - Fine dining with wine pairings

Would you like more details about any of these?

User: "Something cheap and fast"
Assistant: Here are quick, budget-friendly options:
1. **Pizza Corner** - 4.0★, $, 0.1mi - Slices from $3
2. **Pasta Express** - 3.8★, $, 0.2mi - Lunch specials from $8`,
```

## Tool Description Guidelines

### When to Use

Tell the LLM when to call the tool:

```typescript
description: "Search the web for current information. Use when the user asks about recent events, news, or facts that may have changed since your training data. Do NOT use for general knowledge questions you can answer directly.",
```

### What It Returns

Tell the LLM what to expect:

```typescript
description: "Read a file from the filesystem. Returns the file content as text. If the file is binary, returns a base64-encoded string with a warning.",
```

### Limitations

Document constraints:

```typescript
description: "Fetch a web page and extract its text content. Limited to pages under 50KB. JavaScript-rendered content will not be captured.",
```

## Multi-Turn Prompt Design

For agents that need to maintain context across turns:

```typescript
systemPrompt: `You are a customer support agent. You have access to:
- order_lookup: Find orders by email or order ID
- refund_process: Initiate a refund for an order
- shipping_status: Check shipping status

When a user contacts you:
1. First identify their order (use order_lookup)
2. Then address their specific issue
3. Always confirm the order details before taking action

If you can't find the order, ask for clarification.`,
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Vague system prompt | Be specific about role, constraints, and output format |
| No tool usage guidance | Tell the LLM when to use each tool |
| Too many tools | Start with 2-3, add more as needed |
| Conflicting instructions | Review prompt for contradictions |
| No error handling guidance | Tell the LLM what to do when tools fail |

## Testing Prompts

Test your prompts with edge cases:

```typescript
// Does the agent handle ambiguous requests?
agent.run("Tell me about it");

// Does it use tools when appropriate?
agent.run("What's the weather?"); // Should call weather tool

// Does it handle unknown tools gracefully?
// (The LLM might hallucinate — check the response)
```

## Next Steps

- [**Agent Guide**](/typescript/agent) — Agent configuration
- [**Tool Design Patterns**](/guides/tool-design-patterns) — Writing effective tools
