import type { AgentConfig } from "@spectra/agent";
import type { Model, Message, Usage } from "@spectra/ai";

export interface Session {
  id: string;
  model: Model;
  messages: Message[];
  config: SessionConfig;
  metadata: SessionMetadata;
}

export interface SessionConfig extends AgentConfig {
  maxTokens?: number;
  temperature?: number;
  apiKey?: string;
}

export interface SessionMetadata {
  createdAt: Date;
  updatedAt: Date;
  turnCount: number;
  tokenUsage: Usage;
  isStreaming: boolean;
  error?: string;
  parentSessionId?: string;
  userId?: string;
  tenantId?: string;
}

export interface SessionFilter {
  userId?: string;
  tenantId?: string;
  limit?: number;
  offset?: number;
  status?: "active" | "completed" | "error";
}

export interface SessionStore {
  create(session: Session): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
}

export interface SessionManager {
  create(config: SessionConfig, userId?: string): Promise<Session>;
  load(id: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  delete(id: string): Promise<void>;
  list(filter?: SessionFilter): Promise<Session[]>;
  fork(sourceId: string, branchFromIndex?: number): Promise<Session>;
}

export interface WorkerPool {
  enqueue(sessionId: string, input: string): Promise<string>;
  process(handler: (job: WorkerJob) => Promise<WorkerResult>): Promise<void>;
  stop(): Promise<void>;
}

export interface WorkerJob {
  id: string;
  sessionId: string;
  input: string;
  createdAt: Date;
  priority: number;
}

export interface WorkerResult {
  jobId: string;
  success: boolean;
  events?: any[];
  error?: string;
}

export interface RateLimiter {
  checkLimit(userId: string): Promise<RateLimitResult>;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface Orchestrator {
  delegate(agentType: string, task: string, budget?: Budget): Promise<DelegationResult>;
  executeParallel(tasks: TaskConfig[]): Promise<DelegationResult[]>;
}

export interface Budget {
  maxTokens?: number;
  timeoutMs?: number;
}

export interface TaskConfig {
  agentType: string;
  task: string;
  budget?: Budget;
}

export interface DelegationResult {
  agentType: string;
  success: boolean;
  result: string;
  usage?: Usage;
  error?: string;
}
