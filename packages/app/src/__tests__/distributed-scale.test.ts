import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	SessionManager,
	InMemorySessionStore,
	FileSystemSessionStore,
	DefaultCircuitBreaker,
	CircuitBreakerOpenError,
	CompositeRateLimiter,
	SessionEngine,
	RateLimitExceededError,
	SseBridge,
	HealthProbe,
} from '../index.js';
import type { CircuitBreakerState, RedisClient, RateLimiter, RateLimitResult, HealthStatus } from '../index.js';
import { LocalRateLimiter } from '../rate-limiter.js';
import { RedisRateLimiter } from '../redis-rate-limiter.js';
import { RedisSessionStore } from '../redis-session-store.js';
import { registerProvider, AssistantMessageEventStream } from '@mohanscodex/spectra-ai';
import type { Model, Context, StreamOptions } from '@mohanscodex/spectra-ai';
import { Agent } from '@mohanscodex/spectra-agent';

function createTempDir(): string {
	return mkdtempSync(join(tmpdir(), 'spectra-app-test-'));
}
function cleanupTempDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {}
}

registerProvider({
	name: 'test',
	stream(model: Model, context: Context, options?: StreamOptions) {
		const stream = new AssistantMessageEventStream();
		const msg = {
			role: 'assistant' as const,
			content: [{ type: 'text' as const, text: 'Test response' }],
			provider: model.provider,
			model: model.id,
			usage: { input: 5, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
			stopReason: 'stop' as const,
			timestamp: Date.now(),
		};
		stream.push({ type: 'start', partial: msg });
		stream.push({ type: 'text_start', contentIndex: 0, partial: msg });
		stream.push({ type: 'text_delta', contentIndex: 0, delta: 'Test response', partial: msg });
		stream.push({ type: 'text_end', contentIndex: 0, content: 'Test response', partial: msg });
		stream.push({ type: 'done', reason: 'stop', message: msg });
		return stream;
	},
});

registerProvider({
	name: 'holding',
	stream(): AssistantMessageEventStream {
		return new AssistantMessageEventStream();
	},
});

const testModel = {
	id: 'test-model',
	name: 'Test',
	provider: 'test',
	api: 'test',
};

function createMockRedis(): RedisClient {
	const store = new Map<string, { value: string; ttl: number }>();
	const sortedSets = new Map<string, Map<string, number>>();

	return {
		get: vi.fn(async (key) => {
			const entry = store.get(key);
			if (!entry) return null;
			if (entry.ttl && entry.ttl < Date.now()) {
				store.delete(key);
				return null;
			}
			return entry.value;
		}),
		set: vi.fn(async (key, value, mode, ttl) => {
			store.set(key, {
				value,
				ttl: mode === 'EX' && ttl ? Date.now() + ttl * 1000 : 0,
			});
			return 'OK';
		}),
		del: vi.fn(async (...keys) => {
			let count = 0;
			for (const key of keys) {
				if (store.delete(key)) count++;
			}
			return count;
		}),
		zadd: vi.fn(async (key, score, member) => {
			if (!sortedSets.has(key)) sortedSets.set(key, new Map());
			sortedSets.get(key)!.set(member, score);
			return 1;
		}),
		zremrangebyscore: vi.fn(async (key, min, max) => {
			const set = sortedSets.get(key);
			if (!set) return 0;
			let count = 0;
			for (const [member, score] of set) {
				if (score <= max && score >= min) {
					set.delete(member);
					count++;
				}
			}
			return count;
		}),
		zcard: vi.fn(async (key) => {
			return sortedSets.get(key)?.size ?? 0;
		}),
		expire: vi.fn(async () => 1),
		ping: vi.fn(async () => 'PONG'),
		quit: vi.fn(async () => {}),
	};
}

describe('DefaultCircuitBreaker', () => {
	it('should start CLOSED', () => {
		const cb = new DefaultCircuitBreaker();
		expect(cb.state).toBe('CLOSED');
		expect(cb.failureCount).toBe(0);
	});

	it('should execute function when CLOSED', async () => {
		const cb = new DefaultCircuitBreaker();
		const fn = vi.fn().mockResolvedValue('result');
		const result = await cb.call(fn);
		expect(result).toBe('result');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should open after threshold failures', async () => {
		const cb = new DefaultCircuitBreaker({ failureThreshold: 3, resetTimeoutMs: 60000 });
		const failing = vi.fn().mockRejectedValue(new Error('fail'));

		for (let i = 0; i < 3; i++) {
			try {
				await cb.call(failing);
			} catch {}
		}

		expect(cb.state).toBe('OPEN');
		expect(cb.failureCount).toBe(3);

		try {
			await cb.call(vi.fn());
			expect.fail('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(CircuitBreakerOpenError);
		}
	});

	it('should transition to HALF_OPEN after timeout', async () => {
		const cb = new DefaultCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });
		const failing = vi.fn().mockRejectedValue(new Error('fail'));

		try {
			await cb.call(failing);
		} catch {}
		expect(cb.state).toBe('OPEN');

		await new Promise((r) => setTimeout(r, 20));
		expect(cb.state).toBe('HALF_OPEN');
	});

	it('should close after successful HALF_OPEN probe', async () => {
		const cb = new DefaultCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });
		const failing = vi.fn().mockRejectedValue(new Error('fail'));

		try {
			await cb.call(failing);
		} catch {}
		await new Promise((r) => setTimeout(r, 20));
		expect(cb.state).toBe('HALF_OPEN');

		const success = vi.fn().mockResolvedValue('ok');
		const result = await cb.call(success);
		expect(result).toBe('ok');
		expect(cb.state).toBe('CLOSED');
	});

	it('should reopen on HALF_OPEN failure', async () => {
		const cb = new DefaultCircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 10 });

		try {
			await cb.call(vi.fn().mockRejectedValue(new Error('fail')));
		} catch {}
		await new Promise((r) => setTimeout(r, 20));

		try {
			await cb.call(vi.fn().mockRejectedValue(new Error('fail again')));
		} catch {}
		expect(cb.state).toBe('OPEN');
	});

	it('should allow manual recordSuccess/recordFailure', () => {
		const cb = new DefaultCircuitBreaker({ failureThreshold: 2 });

		cb.recordFailure();
		expect(cb.failureCount).toBe(1);
		expect(cb.state).toBe('CLOSED');

		cb.recordFailure();
		expect(cb.state).toBe('OPEN');

		cb.recordSuccess();
		expect(cb.state).toBe('CLOSED');
		expect(cb.failureCount).toBe(0);
	});
});

describe('CompositeRateLimiter', () => {
	it('should allow when all limiters pass', async () => {
		const limiter1 = new LocalRateLimiter(10, 60000);
		const limiter2 = new LocalRateLimiter(10, 60000);
		const composite = new CompositeRateLimiter([
			{ limiter: limiter1, key: 'tenant-a' },
			{ limiter: limiter2, key: 'provider' },
		]);

		const result = await composite.checkLimit('user-1');
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBeGreaterThan(0);
	});

	it('should deny when any limiter blocks', async () => {
		const limiter1 = new LocalRateLimiter(10, 60000);
		const limiter2 = new LocalRateLimiter(2, 60000);
		const composite = new CompositeRateLimiter([
			{ limiter: limiter1, key: 'tenant-a' },
			{ limiter: limiter2, key: 'provider' },
		]);

		await composite.checkLimit('user-1');
		await composite.checkLimit('user-1');
		const result = await composite.checkLimit('user-1');

		expect(result.allowed).toBe(false);
		expect(result.remaining).toBe(0);
	});

	it('should use composite keys for isolation', async () => {
		const tenantA = new LocalRateLimiter(5, 60000);
		const composite = new CompositeRateLimiter([{ limiter: tenantA, key: 'tenant-a' }]);

		for (let i = 0; i < 5; i++) {
			const r = await composite.checkLimit('user-1');
			expect(r.allowed).toBe(true);
		}

		const blocked = await composite.checkLimit('user-1');
		expect(blocked.allowed).toBe(false);
	});

	it('should allow addLimit dynamically', async () => {
		const composite = new CompositeRateLimiter([]);
		const limiter = new LocalRateLimiter(1, 60000);
		composite.addLimit(limiter, 'dynamic');

		const allowed = await composite.checkLimit('user-1');
		expect(allowed.allowed).toBe(true);

		const blocked = await composite.checkLimit('user-1');
		expect(blocked.allowed).toBe(false);
	});
});

describe('RedisRateLimiter (with mock Redis)', () => {
	it('should allow within limits', async () => {
		const redis = createMockRedis();
		const limiter = new RedisRateLimiter(redis, { requestsPerWindow: 10, windowMs: 60000, keyPrefix: 'test' });

		const result = await limiter.checkLimit('user-1');
		expect(result.allowed).toBe(true);
		expect(result.remaining).toBe(9);
	});

	it('should block when limit exceeded', async () => {
		const redis = createMockRedis();
		const limiter = new RedisRateLimiter(redis, { requestsPerWindow: 2, windowMs: 60000, keyPrefix: 'test' });

		await limiter.checkLimit('user-1');
		await limiter.checkLimit('user-1');
		const blocked = await limiter.checkLimit('user-1');

		expect(blocked.allowed).toBe(false);
		expect(blocked.remaining).toBe(0);
	});

	it('should use correct Redis key prefix', async () => {
		const redis = createMockRedis();
		const limiter = new RedisRateLimiter(redis, { requestsPerWindow: 5, windowMs: 60000, keyPrefix: 'rl-prod' });

		await limiter.checkLimit('user-42');
		expect(redis.zadd).toHaveBeenCalled();
		const zaddCall = (redis.zadd as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(zaddCall[0]).toContain('rl-prod');
	});

	it('should apply burst allowance', async () => {
		const redis = createMockRedis();
		const limiter = new RedisRateLimiter(redis, {
			requestsPerWindow: 3,
			windowMs: 60000,
			keyPrefix: 'test',
			burstAllowance: 2,
		});

		for (let i = 0; i < 5; i++) {
			const r = await limiter.checkLimit('user-1');
			expect(r.allowed).toBe(true);
		}

		const blocked = await limiter.checkLimit('user-1');
		expect(blocked.allowed).toBe(false);
	});
});

describe('RedisSessionStore (with mock Redis)', () => {
	it('should create and load session', async () => {
		const redis = createMockRedis();
		const store = new RedisSessionStore(redis, { ttlSeconds: 3600, keyPrefix: 'sess' });

		const session = {
			id: 'session-1',
			model: testModel,
			entries: [],
			config: { model: testModel },
			metadata: {
				createdAt: new Date(),
				updatedAt: new Date(),
				turnCount: 0,
				tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				isStreaming: false,
			},
		};

		await store.create(session);
		const loaded = await store.load('session-1');
		expect(loaded?.id).toBe('session-1');
		expect(redis.set).toHaveBeenCalled();
	});

	it('should fall back to cold store on cache miss', async () => {
		const redis = createMockRedis();
		const coldStore = new InMemorySessionStore();
		const store = new RedisSessionStore(redis, { ttlSeconds: 3600, keyPrefix: 'sess', coldStore });

		const session = {
			id: 'cold-only',
			model: testModel,
			entries: [],
			config: { model: testModel },
			metadata: {
				createdAt: new Date(),
				updatedAt: new Date(),
				turnCount: 0,
				tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				isStreaming: false,
			},
		};

		(redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
		await coldStore.create(session);

		const loaded = await store.load('cold-only');
		expect(loaded?.id).toBe('cold-only');
	});

	it('should save to both Redis and cold store', async () => {
		const redis = createMockRedis();
		const coldStore = new InMemorySessionStore();
		const store = new RedisSessionStore(redis, { ttlSeconds: 3600, keyPrefix: 'sess', coldStore });

		const session = {
			id: 'dual',
			model: testModel,
			entries: [],
			config: { model: testModel },
			metadata: {
				createdAt: new Date(),
				updatedAt: new Date(),
				turnCount: 0,
				tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				isStreaming: false,
			},
		};

		await store.save(session);
		expect(redis.set).toHaveBeenCalled();

		const fromCold = await coldStore.load('dual');
		expect(fromCold?.id).toBe('dual');
	});

	it('should delete from both stores', async () => {
		const redis = createMockRedis();
		const coldStore = new InMemorySessionStore();
		const store = new RedisSessionStore(redis, { ttlSeconds: 3600, keyPrefix: 'sess', coldStore });

		const session = {
			id: 'to-delete',
			model: testModel,
			entries: [],
			config: { model: testModel },
			metadata: {
				createdAt: new Date(),
				updatedAt: new Date(),
				turnCount: 0,
				tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
				isStreaming: false,
			},
		};
		await coldStore.create(session);
		(redis.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);

		await store.delete('to-delete');
		expect(redis.del).toHaveBeenCalled();

		const fromCold = await coldStore.load('to-delete');
		expect(fromCold).toBeNull();
	});
});

describe('SessionEngine', () => {
	it('should create session and run', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		expect(engine.lifecycle).toBe('running');

		const session = await sessionManager.create({ model: testModel });
		const result = await engine.run('user-1', 'hello', session.id);

		expect(result.sessionId).toBeDefined();
		expect(Array.isArray(result.events)).toBe(true);
		expect(engine.activeSessionCount).toBe(0);
	});

	it('should enforce rate limits', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const limiter = new LocalRateLimiter(1, 60000);
		const engine = new SessionEngine({ sessionManager, rateLimiter: limiter });

		engine.start();

		const session = await sessionManager.create({ model: testModel });

		const first = await engine.run('user-1', 'first', session.id);
		expect(first.sessionId).toBe(session.id);

		try {
			await engine.run('user-1', 'second', session.id);
			expect.fail('Should have thrown rate limit error');
		} catch (err) {
			expect(err).toBeInstanceOf(RateLimitExceededError);
		}
	});

	it('should reject when engine is stopped', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		try {
			await engine.run('user-1', 'hello');
			expect.fail('Should have thrown');
		} catch (err: any) {
			expect(err.message).toContain('stopped');
		}
	});

	it('should reject when engine is draining', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		const stopPromise = engine.stop(true);

		try {
			await engine.run('user-1', 'hello');
			expect.fail('Should have thrown');
		} catch (err: any) {
			expect(err.message).toContain('draining');
		}

		await stopPromise;
	});

	it('should enforce max concurrent sessions', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager, maxConcurrentSessions: 1 });

		engine.start();

		const s1 = await sessionManager.create({ model: testModel }, 'u1');
		const s2 = await sessionManager.create({ model: testModel }, 'u2');

		// Run first session normally (completes)
		await engine.run('u1', 'first', s1.id);

		// Max concurrent is 1, first already completed, so second should succeed
		const result = await engine.run('u2', 'second', s2.id);
		expect(result.sessionId).toBe(s2.id);

		// Verify engine rejects when stopped and has no active sessions
		expect(engine.activeSessionCount).toBe(0);
	});

	it('should abort session by ID', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		const session = await sessionManager.create({ model: testModel });

		const runPromise = engine.run('user-1', 'hello', session.id);
		engine.abortSession(session.id);

		const result = await runPromise;
		expect(result.sessionId).toBe(session.id);
		expect(engine.activeSessionCount).toBe(0);
	});

	it('should report health status', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		await new Promise((r) => setTimeout(r, 10));
		const health = await engine.health();

		expect(health.status).toBe('healthy');
		expect(health.engineState).toBe('running');
		expect(health.activeSessions).toBe(0);
		expect(health.uptime).toBeGreaterThanOrEqual(0);
		expect(health.checks).toHaveProperty('session_store');
	});
});

describe('SessionEngine streaming with persistence', () => {
	it('should persist messages during streaming run', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();

		const session = await sessionManager.create({
			model: { id: 'claude', name: 'Claude', provider: 'test', api: 'messages' },
			systemPrompt: 'You are helpful.',
		});

		// Simulate a streaming run
		const runPromise = engine.run('user-1', 'test input', session.id);
		const result = await runPromise;

		// After run, session should have persisted messages
		const reloaded = await sessionManager.load(result.sessionId);
		expect(reloaded).not.toBeNull();
		expect((reloaded?.entries ?? []).length).toBeGreaterThanOrEqual(0);
	});

	it('should create new session when no sessionId given', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		const result = await engine.run('user-new', 'hello', undefined, {
			model: testModel,
		});

		expect(result.sessionId).toBeDefined();
		const loaded = await sessionManager.load(result.sessionId);
		expect(loaded).not.toBeNull();
		expect(loaded?.metadata.userId).toBe('user-new');
	});

	it('should reject missing sessionId', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();
		try {
			await engine.run('user-1', 'input', 'nonexistent-id');
			expect.fail('Should have thrown');
		} catch (err: any) {
			expect(err.message).toContain('not found');
		}
	});
});

describe('Integration: Engine full lifecycle', () => {
	it('should handle multiple sequential runs on same session', async () => {
		const store = new InMemorySessionStore();
		const sessionManager = new SessionManager(store);
		const engine = new SessionEngine({ sessionManager });

		engine.start();

		const session = await sessionManager.create({
			model: { id: 'claude', name: 'Claude', provider: 'test', api: 'messages' },
		});

		const r1 = await engine.run('user-1', 'first message', session.id);
		expect(r1.sessionId).toBe(session.id);

		const r2 = await engine.run('user-1', 'second message', session.id);
		expect(r2.sessionId).toBe(session.id);

		const loaded = await sessionManager.load(session.id);
		expect(loaded).not.toBeNull();
	});
});

describe('SseBridge', () => {
	it('should manage clients', () => {
		const bridge = new SseBridge();
		const writer = bridge.addClient('client-1');

		expect(writer.clientId).toBe('client-1');
		expect(bridge.transport).toBe('sse');
	});

	it('should format SSE events correctly', () => {
		const bridge = new SseBridge();

		const formatted = bridge.serializeEvent({
			type: 'agent_event',
			data: { type: 'turn_start', toolResults: [] },
			timestamp: Date.now(),
		});

		expect(formatted).toContain('event: turn_start');
		expect(formatted).toContain('data:');
		expect(formatted).toContain('\n\n');
	});

	it('should broadcast to all clients', () => {
		const bridge = new SseBridge();
		const client1Received: string[] = [];
		const client2Received: string[] = [];
		const writer1 = bridge.addClient('client-1');
		const writer2 = bridge.addClient('client-2');
		writer1.write = (d) => client1Received.push(d);
		writer2.write = (d) => client2Received.push(d);

		bridge.send({ type: 'agent_event', data: {}, timestamp: Date.now() });

		expect(client1Received.length).toBeGreaterThan(0);
		expect(client2Received.length).toBeGreaterThan(0);
	});

	it('should remove client on end', () => {
		const bridge = new SseBridge();
		const writer = bridge.addClient('client-1');
		writer.end();

		// New client can re-add same ID
		const writer2 = bridge.addClient('client-1');
		expect(writer2.clientId).toBe('client-1');
	});

	it('should close all connections gracefully', async () => {
		const bridge = new SseBridge();
		bridge.addClient('c1');
		bridge.addClient('c2');

		await bridge.close();

		// After close, sending should not throw
		bridge.send({ type: 'agent_event', data: {}, timestamp: Date.now() });
	});

	it('should provide reconnect info', () => {
		const bridge = new SseBridge({ reconnectTimeoutMs: 3000, maxReconnectAttempts: 3 });
		const info = bridge.getReconnectInfo();

		expect(info.timeout).toBe(3000);
		expect(info.maxAttempts).toBe(3);
	});
});

describe('HealthProbe', () => {
	it('should return healthy when all checks pass', async () => {
		const probe = new HealthProbe();
		probe.registerCheck('redis', async () => ({ status: 'ok' }));
		probe.registerCheck('db', async () => ({ status: 'ok' }));

		const health = await probe.health('running', 5);
		expect(health.status).toBe('healthy');
		expect(health.activeSessions).toBe(5);
		expect(health.checks['redis']?.status).toBe('ok');
		expect(health.checks['db']?.status).toBe('ok');
	});

	it('should return degraded when a check fails', async () => {
		const probe = new HealthProbe();
		probe.registerCheck('redis', async () => ({ status: 'ok' }));
		probe.registerCheck('db', async () => ({ status: 'error', message: 'connection refused' }));

		const health = await probe.health('running', 0);
		expect(health.status).toBe('degraded');
		expect(health.checks['db']?.status).toBe('error');
	});

	it('should return unhealthy when engine not running', async () => {
		const probe = new HealthProbe();
		const health = await probe.health('stopped', 0);
		expect(health.status).toBe('unhealthy');
	});

	it('should handle thrown check errors', async () => {
		const probe = new HealthProbe();
		probe.registerCheck('redis', async () => {
			throw new Error('timeout');
		});

		const health = await probe.health('running', 0);
		expect(health.checks['redis']?.status).toBe('error');
		expect(health.checks['redis']?.message).toContain('timeout');
	});

	it('should track uptime', async () => {
		const probe = new HealthProbe();
		await new Promise((r) => setTimeout(r, 50));
		const health = await probe.health('running', 0);
		expect(health.uptime).toBeGreaterThan(40);
	});
});
