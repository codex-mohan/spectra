import type { AgentConfig, AgentTool, AgentEvent } from '@mohanscodex/spectra-agent';
import type { Model, Message, Usage, StreamOptions } from '@mohanscodex/spectra-ai';

export interface SessionEntryBase {
	id: string;
	parentId: string | null;
	timestamp: number;
}

export interface MessageEntry extends SessionEntryBase {
	type: 'message';
	message: Message;
}

export interface ModelChangeEntry extends SessionEntryBase {
	type: 'model_change';
	provider: string;
	modelId: string;
}

export interface AuditEntry extends SessionEntryBase {
	type: 'audit';
	eventType: string;
	details: Record<string, unknown>;
}

export interface CustomEntry extends SessionEntryBase {
	type: 'custom';
	customType: string;
	data: unknown;
}

export type SessionEntry = MessageEntry | ModelChangeEntry | AuditEntry | CustomEntry;

export interface SessionTreeNode {
	entry: SessionEntry;
	children: SessionTreeNode[];
}

export interface SessionContext {
	messages: Message[];
	model: Model;
}

export interface Session {
	id: string;
	model: Model;
	entries: SessionEntry[];
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
	status?: 'active' | 'completed' | 'error';
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
	appendMessage(session: Session, message: Message): MessageEntry;
	appendAudit(session: Session, eventType: string, details: Record<string, unknown>): AuditEntry;
	appendCustom(session: Session, customType: string, data: unknown): CustomEntry;
	appendModelChange(session: Session, model: Model): ModelChangeEntry;
	appendEntry(
		session: Session,
		entry:
			| Omit<MessageEntry, 'id' | 'parentId' | 'timestamp'>
			| Omit<ModelChangeEntry, 'id' | 'parentId' | 'timestamp'>
			| Omit<AuditEntry, 'id' | 'parentId' | 'timestamp'>
			| Omit<CustomEntry, 'id' | 'parentId' | 'timestamp'>,
	): SessionEntry;
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

export interface DelegateOptions {
	parentModel?: Model;
	parentSessionId?: string;
	signal?: AbortSignal;
	onEvent?: (event: AgentEvent) => void;
	tools?: AgentTool[];
	budget?: Budget;
}

export interface Orchestrator {
	delegate(agentType: string, task: string, opts?: DelegateOptions): Promise<DelegationResult>;
	executeParallel(tasks: TaskConfig[], opts?: Pick<DelegateOptions, 'parentModel' | 'parentSessionId' | 'signal'>): Promise<DelegationResult[]>;
}

export interface Budget {
	maxTurns?: number;
	maxTokens?: number;
	timeoutMs?: number;
}

export interface TaskConfig {
	agentType: string;
	task: string;
	tools?: AgentTool[];
	budget?: Budget;
}

export interface DelegationResult {
	agentType: string;
	success: boolean;
	result: string;
	messages?: Message[];
	childSessionId?: string;
	usage?: Usage;
	error?: string;
}

export interface RedisClient {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, mode?: 'EX', ttl?: number): Promise<'OK' | null>;
	del(...keys: string[]): Promise<number>;
	zadd(key: string, score: number, member: string): Promise<number>;
	zremrangebyscore(key: string, min: number, max: number): Promise<number>;
	zcard(key: string): Promise<number>;
	expire(key: string, seconds: number): Promise<number>;
	ping(): Promise<string>;
	quit(): Promise<void>;
}

export type CircuitBreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
	failureThreshold: number;
	resetTimeoutMs: number;
	halfOpenMaxRequests: number;
}

export interface CircuitBreaker {
	readonly state: CircuitBreakerState;
	readonly failureCount: number;
	call<T>(fn: () => Promise<T>): Promise<T>;
	recordSuccess(): void;
	recordFailure(): void;
}

export type EngineLifecycle = 'starting' | 'running' | 'draining' | 'stopped';

export interface TenantContext {
	tenantId: string;
	quota: {
		maxConcurrentSessions: number;
		maxTokensPerDay: number;
		maxSessions: number;
	};
	rateLimiter: RateLimiter;
	getApiKey(provider: string): Promise<string | undefined>;
}

export interface TenantResolver {
	resolve(tenantId: string): Promise<TenantContext | null>;
}

export type ConnectionTransport = 'sse' | 'websocket';

export interface ConnectionConfig {
	transport: ConnectionTransport;
	heartbeatIntervalMs?: number;
	reconnectTimeoutMs?: number;
	maxReconnectAttempts?: number;
	cors?: { origin: string | string[] };
}

export interface EngineEvent {
	type:
		| 'engine_start'
		| 'engine_stop'
		| 'connection_open'
		| 'connection_close'
		| 'reconnect'
		| 'agent_event'
		| 'error';
	data?: unknown;
	timestamp: number;
}

export interface SessionEngineConfig {
	sessionManager: SessionManager;
	rateLimiter?: RateLimiter;
	tenantResolver?: TenantResolver;
	circuitBreaker?: CircuitBreaker;
	engineId?: string;
	defaultStreamOptions?: StreamOptions;
	maxConcurrentSessions?: number;
	sessionTimeoutMs?: number;
}

export interface SessionEngineResult {
	sessionId: string;
	events: AgentEvent[];
	finalMessage: string;
	tokenUsage: Usage;
}

export interface HealthStatus {
	status: 'healthy' | 'degraded' | 'unhealthy';
	uptime: number;
	activeSessions: number;
	engineState: EngineLifecycle;
	checks: Record<string, { status: 'ok' | 'error'; message?: string }>;
}

export interface ConnectionBridge {
	readonly transport: ConnectionTransport;
	attach(handler: (event: EngineEvent) => void): void;
	detach(handler: (event: EngineEvent) => void): void;
	send(event: EngineEvent): void;
	close(): Promise<void>;
}

export interface JobQueue {
	enqueue<T = unknown>(queue: string, payload: T): Promise<string>;
	dequeue<T = unknown>(queue: string, timeoutMs?: number): Promise<{ id: string; payload: T } | null>;
	ack(queue: string, id: string): Promise<void>;
	nack(queue: string, id: string, retryDelayMs?: number): Promise<void>;
	size(queue: string): Promise<number>;
}
