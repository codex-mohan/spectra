import type { Message, StreamOptions, Usage } from "@mohanscodex/spectra-ai";
import type { AgentEvent, AgentConfig } from "@mohanscodex/spectra-agent";
import { Agent } from "@mohanscodex/spectra-agent";
import type {
  Session,
  SessionEngineConfig,
  SessionEngineResult,
  EngineLifecycle,
  EngineEvent,
  RateLimiter,
  ConnectionBridge,
  HealthStatus,
} from "./types.js";

interface ActiveSession {
  session: Session;
  agent: Agent;
  startTime: number;
  abortController: AbortController;
}

export class SessionEngine {
  private config: SessionEngineConfig;
  private activeSessions = new Map<string, ActiveSession>();
  private _lifecycle: EngineLifecycle = "stopped";
  private _startTime = 0;
  private bridge?: ConnectionBridge;

  constructor(config: SessionEngineConfig) {
    this.config = {
      maxConcurrentSessions: 100,
      sessionTimeoutMs: 300000,
      engineId: `engine-${Math.random().toString(36).slice(2, 10)}`,
      ...config,
    };
  }

  get lifecycle(): EngineLifecycle {
    return this._lifecycle;
  }

  get activeSessionCount(): number {
    return this.activeSessions.size;
  }

  attachBridge(bridge: ConnectionBridge): void {
    this.bridge = bridge;
  }

  start(): void {
    if (this._lifecycle === "running") return;
    this._lifecycle = "running";
    this._startTime = Date.now();
    this.emit("engine_start", { engineId: this.config.engineId });
  }

  async stop(drain = true): Promise<void> {
    this._lifecycle = "draining";
    this.emit("engine_stop", { draining: drain });

    if (drain) {
      await this.drainActiveSessions();
    } else {
      for (const [id, active] of this.activeSessions) {
        active.abortController.abort();
        this.activeSessions.delete(id);
      }
    }

    this._lifecycle = "stopped";
  }

  async run(
    userId: string,
    input: string,
    sessionId?: string,
    options?: {
      tenantId?: string;
      streamOptions?: StreamOptions;
      tools?: AgentConfig["tools"];
      model?: AgentConfig["model"];
    }
  ): Promise<SessionEngineResult> {
    if (this._lifecycle === "stopped") {
      throw new Error("Engine is stopped. Call start() first.");
    }
    if (this._lifecycle === "draining") {
      throw new Error("Engine is draining. No new sessions accepted.");
    }

    if (this.activeSessions.size >= (this.config.maxConcurrentSessions ?? 100)) {
      throw new Error(
        `Max concurrent sessions reached (${this.config.maxConcurrentSessions}).`
      );
    }

    if (this.config.rateLimiter) {
      const limitKey = options?.tenantId
        ? `${options.tenantId}:${userId}`
        : userId;
      const limit = await this.config.rateLimiter.checkLimit(limitKey);
      if (!limit.allowed) {
        throw new RateLimitExceededError(
          `Rate limit exceeded. Reset at ${limit.resetAt.toISOString()}`
        );
      }
    }

    let session: Session;
    if (sessionId) {
      const loaded = await this.config.sessionManager.load(sessionId);
      if (!loaded) {
        throw new Error(`Session not found: ${sessionId}`);
      }
      session = loaded;
    } else {
      const model = options?.model ?? { id: "", name: "", provider: "", api: "" };
      session = await this.config.sessionManager.create({ model }, userId);
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.sessionTimeoutMs ?? 300000);

    const agent = new Agent({
      model: session.model,
      systemPrompt: session.config.systemPrompt,
      tools: options?.tools ?? session.config.tools,
      toolExecution: session.config.toolExecution,
      beforeToolCall: session.config.beforeToolCall,
      afterToolCall: session.config.afterToolCall,
      transformContext: session.config.transformContext,
      streamOptions: options?.streamOptions ?? this.config.defaultStreamOptions,
    });

    agent.restoreHistory(
      session.entries
        .filter((e) => e.type === "message")
        .map((e) => (e as { message: Message }).message)
    );

    const active: ActiveSession = {
      session,
      agent,
      startTime: Date.now(),
      abortController,
    };
    this.activeSessions.set(session.id, active);

    const events: AgentEvent[] = [];
    let finalMessage = "";

    try {
      for await (const event of agent.run(input)) {
        events.push(event);

        if (this.bridge) {
          this.bridge.send({
            type: "agent_event",
            data: event,
            timestamp: Date.now(),
          });
        }

        if (event.type === "turn_end") {
          const content = event.message.content[0];
          if (content && "text" in content) {
            finalMessage = (content as { text: string }).text;
          }
          for (const msg of agent.messages) {
            this.config.sessionManager.appendMessage(session, msg);
          }
          await this.config.sessionManager.save(session);
        }
      }
    } catch (err) {
      this.emit("error", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timeout);
      this.activeSessions.delete(session.id);
    }

    const tokenUsage: Usage = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
    };

    const assistantMsg = agent.messages.find((m) => m.role === "assistant");
    if (assistantMsg && "usage" in assistantMsg) {
      Object.assign(tokenUsage, (assistantMsg as { usage: Usage }).usage);
    }

    return {
      sessionId: session.id,
      events,
      finalMessage,
      tokenUsage,
    };
  }

  async runStreaming(
    userId: string,
    input: string,
    sessionId?: string,
    options?: {
      tenantId?: string;
      streamOptions?: StreamOptions;
      tools?: AgentConfig["tools"];
      model?: AgentConfig["model"];
    }
  ): Promise<AsyncGenerator<AgentEvent>> {
    if (this._lifecycle === "stopped") {
      throw new Error("Engine is stopped. Call start() first.");
    }
    if (this._lifecycle === "draining") {
      throw new Error("Engine is draining. No new sessions accepted.");
    }

    if (this.activeSessions.size >= (this.config.maxConcurrentSessions ?? 100)) {
      throw new Error(
        `Max concurrent sessions reached (${this.config.maxConcurrentSessions}).`
      );
    }

    if (this.config.rateLimiter) {
      const limitKey = options?.tenantId
        ? `${options.tenantId}:${userId}`
        : userId;
      const limit = await this.config.rateLimiter.checkLimit(limitKey);
      if (!limit.allowed) {
        throw new RateLimitExceededError(
          `Rate limit exceeded. Reset at ${limit.resetAt.toISOString()}`
        );
      }
    }

    let session: Session;
    if (sessionId) {
      const loaded = await this.config.sessionManager.load(sessionId);
      if (!loaded) throw new Error(`Session not found: ${sessionId}`);
      session = loaded;
    } else {
      const model = options?.model ?? { id: "", name: "", provider: "", api: "" };
      session = await this.config.sessionManager.create({ model }, userId);
    }

    const abortController = new AbortController();
    const timeout = setTimeout(() => {
      abortController.abort();
    }, this.config.sessionTimeoutMs ?? 300000);

    const agent = new Agent({
      model: session.model,
      systemPrompt: session.config.systemPrompt,
      tools: options?.tools ?? session.config.tools,
      toolExecution: session.config.toolExecution,
      beforeToolCall: session.config.beforeToolCall,
      afterToolCall: session.config.afterToolCall,
      transformContext: session.config.transformContext,
      streamOptions: options?.streamOptions ?? this.config.defaultStreamOptions,
    });

    agent.restoreHistory(
      session.entries
        .filter((e) => e.type === "message")
        .map((e) => (e as { message: Message }).message)
    );

    const active: ActiveSession = {
      session,
      agent,
      startTime: Date.now(),
      abortController,
    };
    this.activeSessions.set(session.id, active);

    return (async function* (engine: SessionEngine, sess: Session, ag: Agent, tm: ReturnType<typeof setTimeout>) {
      try {
        for await (const event of ag.run(input)) {
          yield event;

          if (engine.bridge) {
            engine.bridge.send({
              type: "agent_event",
              data: event,
              timestamp: Date.now(),
            });
          }

          if (event.type === "turn_end") {
            for (const msg of ag.messages) {
              engine.config.sessionManager.appendMessage(sess, msg);
            }
            await engine.config.sessionManager.save(sess);
          }
        }
      } catch (err) {
        engine.emit("error", {
          sessionId: sess.id,
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        clearTimeout(tm);
        engine.activeSessions.delete(sess.id);
      }
    })(this, session, agent, timeout);
  }

  async health(): Promise<HealthStatus> {
    const checks: Record<string, { status: "ok" | "error"; message?: string }> = {};

    try {
      await this.config.sessionManager.load("__health_check__");
      checks["session_store"] = { status: "ok" };
    } catch {
      checks["session_store"] = { status: "error", message: "Session store error" };
    }

    let degraded = false;
    for (const check of Object.values(checks)) {
      if (check.status === "error") degraded = true;
    }

    return {
      status: this._lifecycle === "running" ? (degraded ? "degraded" : "healthy") : "unhealthy",
      uptime: this._startTime ? Date.now() - this._startTime : 0,
      activeSessions: this.activeSessions.size,
      engineState: this._lifecycle,
      checks,
    };
  }

  abortSession(sessionId: string): void {
    const active = this.activeSessions.get(sessionId);
    if (active) {
      active.abortController.abort();
      this.activeSessions.delete(sessionId);
    }
  }

  private emit(type: EngineEvent["type"], data?: unknown): void {
    if (this.bridge) {
      this.bridge.send({ type, data, timestamp: Date.now() });
    }
  }

  private async drainActiveSessions(): Promise<void> {
    const activeSessions = Array.from(this.activeSessions.entries());
    const drainPromises = activeSessions.map(
      ([id]) =>
        new Promise<void>((resolve) => {
          const check = () => {
            if (!this.activeSessions.has(id)) {
              resolve();
            } else {
              setTimeout(check, 250);
            }
          };
          check();
        })
    );

    const timeout = new Promise<void>((resolve) =>
      setTimeout(resolve, 30000)
    );

    await Promise.race([Promise.all(drainPromises), timeout]);

    for (const [id, active] of this.activeSessions) {
      active.abortController.abort();
      this.activeSessions.delete(id);
    }
  }
}

export class RateLimitExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitExceededError";
  }
}
