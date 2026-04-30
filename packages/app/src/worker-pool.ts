import { Agent } from "@singularity-ai/spectra-agent";
import type { Session, WorkerJob, WorkerResult } from "./types.js";
import { SessionManager } from "./session-manager.js";

export class SimpleWorkerPool {
  private jobs: WorkerJob[] = [];
  private processing = false;
  private stopped = false;

  constructor(private sessionManager: SessionManager) {}

  async enqueue(sessionId: string, input: string): Promise<string> {
    const job: WorkerJob = {
      id: crypto.randomUUID(),
      sessionId,
      input,
      createdAt: new Date(),
      priority: 0,
    };

    this.jobs.push(job);
    return job.id;
  }

  async process(handler: (job: WorkerJob) => Promise<WorkerResult>): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (!this.stopped && this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) continue;

      try {
        await handler(job);
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err);
      }
    }

    this.processing = false;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    // Wait for current job to complete
    while (this.processing) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export async function createAgentRunner(
  sessionManager: SessionManager,
  session: Session
) {
  return async (job: WorkerJob): Promise<WorkerResult> => {
    try {
      const agent = new Agent({
        model: session.model,
        systemPrompt: session.config.systemPrompt,
        tools: session.config.tools,
        toolExecution: session.config.toolExecution,
      });

      const events: any[] = [];
      for await (const event of agent.run(job.input)) {
        events.push(event);
      }

      // Update session with final messages
      session.messages = agent.messages;
      await sessionManager.save(session);

      return {
        jobId: job.id,
        success: true,
        events,
      };
    } catch (err) {
      return {
        jobId: job.id,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}
