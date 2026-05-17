# AgentRegistry Reference

Register specialist agents and delegate tasks across them.

## Constructor

```typescript
new AgentRegistry()
```

## Methods

| Method | Signature | Description |
|---|---|---|
| `registerAgent` | `(type, config) => void` | Register a specialist agent |
| `delegate` | `(type, task, budget?) => Promise<DelegationResult>` | Delegate to a single agent |
| `executeParallel` | `(tasks) => Promise<DelegationResult[]>` | Run multiple agents concurrently |

## Budget

```typescript
interface Budget {
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
}
```

## TaskConfig

```typescript
interface TaskConfig {
  agentType: string;
  task: string;
  budget?: Budget;
}
```

## DelegationResult

```typescript
interface DelegationResult {
  agentType: string;
  success: boolean;
  result: string;
  usage?: Usage;
  error?: string;
}
```

## Related

- [Multi-Agent Patterns Guide](/guides/multi-agent-patterns) — Delegation strategies
- [Recipe: Multi-Agent Research](/recipes/multi-agent-research) — Full example
