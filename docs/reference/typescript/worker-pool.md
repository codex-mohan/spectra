# WorkerPool Reference

Queue and process agent jobs sequentially.

## SequentialWorkerPool

```typescript
new SequentialWorkerPool(sessionManager: SessionManager)
```

### Methods

| Method | Signature | Description |
|---|---|---|
| `enqueue` | `(sessionId, input) => Promise<string>` | Add a job, returns job ID |
| `process` | `(handler) => Promise<void>` | Process all queued jobs |
| `stop` | `() => Promise<void>` | Graceful shutdown |

## createAgentRunner

```typescript
function createAgentRunner(
  sessionManager: SessionManager,
  session: Session
): (job: WorkerJob) => Promise<WorkerResult>
```

Creates an Agent from session config, runs the input, persists messages, and returns the event list.

## WorkerJob

```typescript
interface WorkerJob {
  id: string;
  sessionId: string;
  input: string;
  createdAt: Date;
  priority: number;
}
```

## WorkerResult

```typescript
interface WorkerResult {
  jobId: string;
  success: boolean;
  events?: any[];
  error?: string;
}
```

## Related

- [Orchestration Guide](/typescript/orchestration) — Usage examples
