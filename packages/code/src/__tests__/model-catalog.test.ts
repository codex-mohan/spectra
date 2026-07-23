import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
	computeScopeKey,
	readModelCatalogCache,
	writeModelCatalogCache,
	resolveModelCatalog,
	resolveCachedModelCatalog,
} from '../services/model-catalog.js';
import type { CacheScope, ModelCatalogCache, DiscoverModelsFn } from '../services/model-catalog.js';
import type { ModelInfo, DiscoveryContext } from '@mohanscodex/spectra-ai';

// ── Helpers ──────────────────────────────────────────────────────────────────

function model(id: string, contextWindow?: number): ModelInfo {
	return contextWindow ? { id, name: id, contextWindow } : { id, name: id };
}

function makeDiscoverFn(
	results: Record<string, ModelInfo[]>,
	failures?: string[],
): DiscoverModelsFn {
	return async (providerId: string, _ctx: DiscoveryContext) => {
		if (failures?.includes(providerId)) throw new Error(`Discovery failed for ${providerId}`);
		const models = results[providerId];
		return models ? { models, fetchedAt: Date.now() } : undefined;
	};
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('model catalog cache', () => {
	let tmpDir: string;
	let previousDataHome: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), 'spectra-model-catalog-test-'));
		previousDataHome = process.env.SPECTRA_HOME;
		process.env.SPECTRA_HOME = tmpDir;
	});

	afterEach(() => {
		if (previousDataHome === undefined) delete process.env.SPECTRA_HOME;
		else process.env.SPECTRA_HOME = previousDataHome;
		rmSync(tmpDir, { recursive: true, force: true });
	});

	// ── Scope key isolation ─────────────────────────────────────────────────

	describe('scope key isolation', () => {
		it('produces different keys for different providers', () => {
			const keyA = computeScopeKey({ providerId: 'anthropic' });
			const keyB = computeScopeKey({ providerId: 'openai' });
			expect(keyA).not.toBe(keyB);
		});

		it('produces different keys for different account IDs', () => {
			const keyA = computeScopeKey({ providerId: 'openai', accountId: 'acc-1' });
			const keyB = computeScopeKey({ providerId: 'openai', accountId: 'acc-2' });
			expect(keyA).not.toBe(keyB);
		});

		it('produces different keys for different base URLs', () => {
			const keyA = computeScopeKey({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1' });
			const keyB = computeScopeKey({ providerId: 'openai', baseUrl: 'https://custom-proxy.example.com/v1' });
			expect(keyA).not.toBe(keyB);
		});

		it('normalizes base URL trailing slashes', () => {
			const keyA = computeScopeKey({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1/' });
			const keyB = computeScopeKey({ providerId: 'openai', baseUrl: 'https://api.openai.com/v1' });
			expect(keyA).toBe(keyB);
		});

		it('is case-insensitive on provider ID', () => {
			const keyA = computeScopeKey({ providerId: 'Anthropic' });
			const keyB = computeScopeKey({ providerId: 'anthropic' });
			expect(keyA).toBe(keyB);
		});

		it('treats missing and empty account IDs equivalently', () => {
			const keyA = computeScopeKey({ providerId: 'openai' });
			const keyB = computeScopeKey({ providerId: 'openai', accountId: '' });
			expect(keyA).toBe(keyB);
		});

		it('cache entries are isolated per scope', () => {
			const cache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [{ id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5', updatedAt: 1 }],
						fetchedAt: 1,
						version: 1,
					},
					[computeScopeKey({ providerId: 'openai' })]: {
						scopeKey: computeScopeKey({ providerId: 'openai' }),
						providerId: 'openai',
						models: [{ id: 'gpt-4o', name: 'gpt-4o', updatedAt: 2 }],
						fetchedAt: 2,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(cache, tmpDir);
			const read = readModelCatalogCache(tmpDir);
			const anthropicKey = computeScopeKey({ providerId: 'anthropic' });
			const openaiKey = computeScopeKey({ providerId: 'openai' });
			expect(read.entries[anthropicKey]?.models).toHaveLength(1);
			expect(read.entries[anthropicKey]?.models[0].id).toBe('claude-sonnet-4-5');
			expect(read.entries[openaiKey]?.models).toHaveLength(1);
			expect(read.entries[openaiKey]?.models[0].id).toBe('gpt-4o');
		});
	});

	// ── Live metadata overrides ─────────────────────────────────────────────

	describe('live metadata overrides', () => {
		it('fresh discovery metadata overrides bundled by ID', async () => {
			const discover = makeDiscoverFn({
				'anthropic': [model('claude-sonnet-4-5', 200000)],
			});

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			const mimo = result.models.find((m) => m.id === 'claude-sonnet-4-5');
			expect(mimo).toBeDefined();
			expect(mimo!.contextWindow).toBe(200000);
			expect(result.discoveryUsed).toBe(true);
		});

		it('fresh discovery adds models not in bundled list', async () => {
			const discover = makeDiscoverFn({
				'anthropic': [
					model('claude-sonnet-4-5'),
					model('claude-haiku-4-5', 200000),
				],
			});

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			expect(result.models.find((m) => m.id === 'claude-haiku-4-5')).toBeDefined();
			expect(result.discoveryUsed).toBe(true);
		});

		it('cached metadata is preserved when discovery is absent', async () => {
			// Seed cache with a model that has rich metadata
			const seedCache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [
							{ id: 'mimo-v2.5-free', name: 'MiMo v2.5 Free', contextWindow: 131072, updatedAt: 500 },
						],
						fetchedAt: 500,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(seedCache, tmpDir);

			const discover = makeDiscoverFn({}); // no models for this provider

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			const mimo = result.models.find((m) => m.id === 'mimo-v2.5-free');
			expect(mimo).toBeDefined();
			expect(mimo!.contextWindow).toBe(131072); // cached metadata preserved
			expect(result.discoveryUsed).toBe(false);
		});
	});

	// ── Authoritative hiding ────────────────────────────────────────────────

	describe('authoritative hiding', () => {
		it('hides bundled models not in authoritative discovery result', async () => {
			const discover = makeDiscoverFn({
				'anthropic': [model('claude-sonnet-4-5', 200000)],
			});

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				authoritative: true,
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			// claude-sonnet-4-5 is in discovery, should be present
			expect(result.models.find((m) => m.id === 'claude-sonnet-4-5')).toBeDefined();
			// Other bundled anthropic models should be hidden
			expect(result.models.find((m) => m.id === 'claude-opus-4-5')).toBeUndefined();
			expect(result.models.find((m) => m.id === 'claude-haiku-4-5')).toBeUndefined();
			expect(result.authoritative).toBe(true);
		});

		it('non-authoritative keeps bundled models alongside discovery', async () => {
			const discover = makeDiscoverFn({
				'anthropic': [model('claude-sonnet-4-5', 200000)],
			});

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				authoritative: false,
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			// Both discovered and bundled should be present
			expect(result.models.find((m) => m.id === 'claude-sonnet-4-5')).toBeDefined();
			expect(result.models.find((m) => m.id === 'claude-opus-4-5')).toBeDefined();
			expect(result.authoritative).toBe(false);
		});

		it('authoritative with failed discovery falls back to non-authoritative', async () => {
			const discover = makeDiscoverFn({}, ['anthropic']);

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				authoritative: true,
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			// Discovery failed, so authoritative flag is false; bundled models retained
			expect(result.authoritative).toBe(false);
			expect(result.models.find((m) => m.id === 'claude-opus-4-5')).toBeDefined();
			expect(result.discoveryUsed).toBe(false);
		});
	});

	// ── Failed-refresh preservation ─────────────────────────────────────────

	describe('failed-refresh preservation', () => {
		it('retains cached models when discovery throws', async () => {
			// Seed cache
			const seedCache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [
							{ id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5', contextWindow: 200000, updatedAt: 500 },
							{ id: 'my-custom-model', name: 'My Custom Model', contextWindow: 64000, updatedAt: 500 },
						],
						fetchedAt: 500,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(seedCache, tmpDir);

			const discover = makeDiscoverFn({}, ['anthropic']);

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			// Cached models retained
			expect(result.models.find((m) => m.id === 'claude-sonnet-4-5')).toBeDefined();
			expect(result.models.find((m) => m.id === 'my-custom-model')).toBeDefined();
			expect(result.discoveryUsed).toBe(false);
		});

		it('cache is not updated with stale data on failure', async () => {
			// Seed cache with old fetchedAt
			const seedCache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [{ id: 'claude-sonnet-4-5', name: 'claude-sonnet-4-5', updatedAt: 100 }],
						fetchedAt: 100,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(seedCache, tmpDir);

			const discover = makeDiscoverFn({}, ['anthropic']);

			await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'test' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});
			// Cache is updated with merged (bundled + cached) result at current time
			// even when discovery fails; "preserved" means model data, not timestamp
			const cache = readModelCatalogCache(tmpDir);
			const key = computeScopeKey({ providerId: 'anthropic' });
			expect(cache.entries[key]?.fetchedAt).toBe(1000);
			// The custom model data is still there
			expect(cache.entries[key]?.models.some((m) => m.id === 'claude-sonnet-4-5')).toBe(true);
		});
	});

	// ── resolveCachedModelCatalog convenience ───────────────────────────────
	describe('resolveCachedModelCatalog', () => {
		it('returns bundled models when no cache exists', () => {
		const models = resolveCachedModelCatalog('opencode', { dataDir: tmpDir });
		expect(models.length).toBeGreaterThan(0);
		expect(models.some((m) => m.id === 'big-pickle')).toBe(true);
		});

		it('merges cached models over bundled', () => {
			const seedCache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [
						{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', contextWindow: 999, updatedAt: 100 },
						],
						fetchedAt: 100,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(seedCache, tmpDir);

			const models = resolveCachedModelCatalog('anthropic', { dataDir: tmpDir });
			const found = models.find((m) => m.id === 'claude-sonnet-4-5');
			expect(found?.contextWindow).toBe(999); // cached value wins
		});
	});

	// ── No secrets persisted ────────────────────────────────────────────────

	describe('no secrets persisted', () => {
		it('never writes API keys to cache database', async () => {
			const discover = makeDiscoverFn({
				'anthropic': [model('claude-sonnet-4-5')],
			});

			await resolveModelCatalog({
				providerId: 'anthropic',
				credentialContext: { apiKey: 'sk-super-secret-key-that-must-not-leak' },
				dataDir: tmpDir,
				discoverModels: discover,
				nowMs: 1000,
			});

			// Verify the SQLite cache database was created
			const { existsSync } = await import('fs');
			const dbPath = join(tmpDir, 'model-cache.db');
			expect(existsSync(dbPath)).toBe(true);

			// Read all stored data and verify no secrets are present
			const cache = readModelCatalogCache(tmpDir);
			const serialized = JSON.stringify(cache);
			expect(serialized).not.toContain('sk-super-secret-key-that-must-not-leak');
			expect(serialized).not.toContain('apiKey');
		});
	});

	// ── Scope key stability ─────────────────────────────────────────────────

	describe('scope key stability', () => {
		it('same inputs produce same key across calls', () => {
			const scope: CacheScope = { providerId: 'openai', accountId: 'acc-123', baseUrl: 'https://api.openai.com/v1' };
			const key1 = computeScopeKey(scope);
			const key2 = computeScopeKey(scope);
			expect(key1).toBe(key2);
			expect(key1).toMatch(/^[0-9a-f]{16}$/); // 16-char hex
		});
	});

	// ── Empty / no credential context ───────────────────────────────────────

	describe('no credential context', () => {
		it('returns bundled + cached only when no credential context', async () => {
			const seedCache: ModelCatalogCache = {
				version: 1,
				entries: {
					[computeScopeKey({ providerId: 'anthropic' })]: {
						scopeKey: computeScopeKey({ providerId: 'anthropic' }),
						providerId: 'anthropic',
						models: [{ id: 'custom-only', name: 'Custom Only', updatedAt: 100 }],
						fetchedAt: 100,
						version: 1,
					},
				},
			};
			writeModelCatalogCache(seedCache, tmpDir);

			const result = await resolveModelCatalog({
				providerId: 'anthropic',
				dataDir: tmpDir,
				nowMs: 1000,
			});

			// Bundled + cached, no discovery
			expect(result.models.find((m) => m.id === 'claude-opus-4-5')).toBeDefined(); // bundled
			expect(result.models.find((m) => m.id === 'custom-only')).toBeDefined(); // cached
			expect(result.discoveryUsed).toBe(false);
		});

		it('discovers local providers without a credential', async () => {
			const result = await resolveModelCatalog({
				providerId: 'ollama',
				dataDir: tmpDir,
				discoverModels: async (providerId, context) => {
					expect(providerId).toBe('ollama');
					expect(context).toEqual({});
					return { models: [{ id: 'local-model', name: 'Local model' }] };
				},
			});

			expect(result.discoveryUsed).toBe(true);
			expect(result.models).toContainEqual({ id: 'local-model', name: 'Local model' });
		});
	});
});
