import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { getGlobalDataDir } from '../utils/paths.js';
import { getProviderModels, discoverProviderModels } from '@mohanscodex/spectra-ai';
import type { ModelInfo, DiscoveryContext } from '@mohanscodex/spectra-ai';

// ── Cache types ──────────────────────────────────────────────────────────────

export interface CacheScope {
	providerId: string;
	accountId?: string;
	baseUrl?: string;
}

export interface CachedModelRecord {
	/** Model ID from the provider */
	id: string;
	/** Human-readable name (may differ from id) */
	name: string;
	/** Context window in tokens, if known */
	contextWindow?: number;
	/** Whether the model supports tool calls */
	supportsTools?: boolean;
	/** Supported input MIME types */
	supportedInputs?: string[];
	/** Timestamp when this record was last refreshed (ms since epoch) */
	updatedAt: number;
}

export interface ModelCatalogCacheEntry {
	/** Scope key the cache was written under */
	scopeKey: string;
	/** Provider ID (for display/debug; not used as lookup key) */
	providerId: string;
	/** Account ID if available */
	accountId?: string;
	/** Base URL if available */
	baseUrl?: string;
	/** Cached models */
	models: CachedModelRecord[];
	/** Timestamp when the cache was written */
	fetchedAt: number;
	/** Whether discovery was authoritative for this scope */
	authoritative?: boolean;
	/** Cache schema version */
	version: number;
}

export interface ModelCatalogCache {
	/** Cache schema version */
	version: number;
	/** Scope key → cache entry */
	entries: Record<string, ModelCatalogCacheEntry>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CACHE_VERSION = 1;
const SEPARATOR = '\0';

// ── Scope key ────────────────────────────────────────────────────────────────

/**
 * Compute a stable, deterministic scope key from provider ID, optional account ID,
 * and optional base URL. The key is insensitive to ordering of components and
 * normalizes the base URL (strips trailing slashes, lowercases protocol/host).
 *
 * Secrets are never included in the key.
 */
export function computeScopeKey(scope: CacheScope): string {
	const providerId = scope.providerId.trim().toLowerCase();
	const accountId = scope.accountId?.trim().toLowerCase() ?? '';
	const baseUrl = normalizeBaseUrl(scope.baseUrl ?? '');

	const raw = `${providerId}${SEPARATOR}${accountId}${SEPARATOR}${baseUrl}`;
	return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

// ── SQLite store (Bun / Node compatible) ────────────────────────────────────

type SqliteDatabase = {
	exec(sql: string): void;
	prepare(sql: string): {
		all(...params: unknown[]): unknown[];
		get(...params: unknown[]): unknown;
		run(...params: unknown[]): { changes: number };
	};
	transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
	close(): void;
};

type DatabaseConstructor = new (path: string) => SqliteDatabase;

function openDatabase(path: string): SqliteDatabase {
	let Database: DatabaseConstructor;
	try {
		Database = require('bun:sqlite').Database as DatabaseConstructor;
	} catch {
		Database = require('better-sqlite3') as DatabaseConstructor;
	}
	return new Database(path);
}

function ensureDataDir(dir: string): void {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * SQLite-backed model catalog cache store.
 *
 * Follows the same Bun/Node compatibility pattern as SessionStore.
 * Each data directory gets its own dedicated `model-cache.db`.
 */
class ModelCatalogStore {
	private db: SqliteDatabase;

	constructor(dataDir?: string) {
		const dir = dataDir ?? getGlobalDataDir();
		ensureDataDir(dir);
		const dbPath = join(dir, 'model-cache.db');
		this.db = openDatabase(dbPath);
		this.db.exec('PRAGMA journal_mode = WAL');
		this.migrate();
	}

	private migrate(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS model_cache_entries (
				scope_key TEXT PRIMARY KEY,
				provider_id TEXT NOT NULL,
				account_id TEXT,
				base_url TEXT,
				fetched_at INTEGER NOT NULL,
				authoritative INTEGER NOT NULL DEFAULT 0,
				version INTEGER NOT NULL DEFAULT 1
			);

			CREATE TABLE IF NOT EXISTS model_cache_models (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				scope_key TEXT NOT NULL,
				model_id TEXT NOT NULL,
				model_name TEXT NOT NULL,
				context_window INTEGER,
				supports_tools INTEGER,
				supported_inputs TEXT,
				updated_at INTEGER NOT NULL,
				FOREIGN KEY (scope_key) REFERENCES model_cache_entries(scope_key) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_cache_models_scope
				ON model_cache_models(scope_key);
		`);
	}

	/**
	 * Reconstruct a full ModelCatalogCache from the SQLite store.
	 */
	readAll(): ModelCatalogCache {
		const entryRows = this.db.prepare(
			'SELECT * FROM model_cache_entries',
		).all() as {
			scope_key: string;
			provider_id: string;
			account_id: string | null;
			base_url: string | null;
			fetched_at: number;
			authoritative: number;
			version: number;
		}[];

		const modelRows = this.db.prepare(
			'SELECT * FROM model_cache_models',
		).all() as {
			scope_key: string;
			model_id: string;
			model_name: string;
			context_window: number | null;
			supports_tools: number | null;
			supported_inputs: string | null;
			updated_at: number;
		}[];

		// Group models by scope key
		const modelsByScope = new Map<string, CachedModelRecord[]>();
		for (const row of modelRows) {
			const record: CachedModelRecord = {
				id: row.model_id,
				name: row.model_name,
				updatedAt: row.updated_at,
			};
			if (row.context_window != null) record.contextWindow = row.context_window;
			if (row.supports_tools != null) record.supportsTools = row.supports_tools === 1;
			if (row.supported_inputs != null) {
				record.supportedInputs = JSON.parse(row.supported_inputs) as string[];
			}
			const existing = modelsByScope.get(row.scope_key);
			if (existing) {
				existing.push(record);
			} else {
				modelsByScope.set(row.scope_key, [record]);
			}
		}

		const entries: Record<string, ModelCatalogCacheEntry> = {};
		for (const row of entryRows) {
			entries[row.scope_key] = {
				scopeKey: row.scope_key,
				providerId: row.provider_id,
				accountId: row.account_id ?? undefined,
				baseUrl: row.base_url ?? undefined,
				models: modelsByScope.get(row.scope_key) ?? [],
				fetchedAt: row.fetched_at,
				authoritative: row.authoritative === 1,
				version: row.version,
			};
		}

		return { version: CACHE_VERSION, entries };
	}

	/**
	 * Read a single cache entry by scope key.
	 */
	getEntry(scopeKey: string): ModelCatalogCacheEntry | undefined {
		const row = this.db.prepare(
			'SELECT * FROM model_cache_entries WHERE scope_key = ?',
		).get(scopeKey) as {
			scope_key: string;
			provider_id: string;
			account_id: string | null;
			base_url: string | null;
			fetched_at: number;
			authoritative: number;
			version: number;
		} | undefined;

		if (!row) return undefined;

		const modelRows = this.db.prepare(
			'SELECT * FROM model_cache_models WHERE scope_key = ?',
		).all(scopeKey) as {
			model_id: string;
			model_name: string;
			context_window: number | null;
			supports_tools: number | null;
			supported_inputs: string | null;
			updated_at: number;
		}[];

		const models: CachedModelRecord[] = modelRows.map((m) => {
			const record: CachedModelRecord = {
				id: m.model_id,
				name: m.model_name,
				updatedAt: m.updated_at,
			};
			if (m.context_window != null) record.contextWindow = m.context_window;
			if (m.supports_tools != null) record.supportsTools = m.supports_tools === 1;
			if (m.supported_inputs != null) {
				record.supportedInputs = JSON.parse(m.supported_inputs) as string[];
			}
			return record;
		});

		return {
			scopeKey: row.scope_key,
			providerId: row.provider_id,
			accountId: row.account_id ?? undefined,
			baseUrl: row.base_url ?? undefined,
			models,
			fetchedAt: row.fetched_at,
			authoritative: row.authoritative === 1,
			version: row.version,
		};
	}

	/**
	 * Insert or replace a cache entry atomically (transactional).
	 * Old models for the same scope key are replaced along with the entry.
	 */
	upsertEntry(entry: ModelCatalogCacheEntry): void {
		const upsert = this.db.transaction(() => {
			this.db.prepare(
				'DELETE FROM model_cache_models WHERE scope_key = ?',
			).run(entry.scopeKey);

			this.db.prepare(
				'DELETE FROM model_cache_entries WHERE scope_key = ?',
			).run(entry.scopeKey);

			this.db.prepare(`
				INSERT INTO model_cache_entries
					(scope_key, provider_id, account_id, base_url, fetched_at, authoritative, version)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(
				entry.scopeKey,
				entry.providerId,
				entry.accountId ?? null,
				entry.baseUrl ?? null,
				entry.fetchedAt,
				entry.authoritative ? 1 : 0,
				entry.version,
			);

			const insertModel = this.db.prepare(`
				INSERT INTO model_cache_models
					(scope_key, model_id, model_name, context_window, supports_tools, supported_inputs, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`);

			for (const m of entry.models) {
				insertModel.run(
					entry.scopeKey,
					m.id,
					m.name,
					m.contextWindow ?? null,
					m.supportsTools != null ? (m.supportsTools ? 1 : 0) : null,
					m.supportedInputs != null ? JSON.stringify(m.supportedInputs) : null,
					m.updatedAt,
				);
			}
		});

		upsert();
	}

	close(): void {
		this.db.close();
	}
}

// ── Cache I/O (public convenience API) ──────────────────────────────────────

/** Read the persisted model catalog cache. */
export function readModelCatalogCache(dataDir?: string): ModelCatalogCache {
	const store = new ModelCatalogStore(dataDir);
	try {
		return store.readAll();
	} finally {
		store.close();
	}
}

/**
 * Write the model catalog cache atomically via SQLite transaction.
 * Each entry is written in a single transaction, ensuring consistency.
 */
export function writeModelCatalogCache(cache: ModelCatalogCache, dataDir?: string): void {
	const store = new ModelCatalogStore(dataDir);
	for (const entry of Object.values(cache.entries)) {
		store.upsertEntry(entry);
	}
	store.close();
}

// ── Cache hydration ──────────────────────────────────────────────────────────

function hydrateCachedModel(record: CachedModelRecord): ModelInfo {
	const info: ModelInfo = { id: record.id, name: record.name };
	if (record.contextWindow !== undefined) info.contextWindow = record.contextWindow;
	if (record.supportsTools !== undefined) info.supportsTools = record.supportsTools;
	if (record.supportedInputs !== undefined) info.supportedInputs = record.supportedInputs;
	return info;
}

// ── Discovery call adapter ───────────────────────────────────────────────────

/**
 * Type for the discovery function injected by the caller. This allows tests to
 * provide local functions instead of real HTTP calls.
 */
export type DiscoverModelsFn = (
	providerId: string,
	context: DiscoveryContext,
) => Promise<{ models: ModelInfo[]; fetchedAt?: number } | undefined>;

// ── Resolver ─────────────────────────────────────────────────────────────────

export interface ResolveModelCatalogOptions {
	/** Provider ID to resolve models for */
	providerId: string;
	/** Credential context (secrets are never persisted) */
	credentialContext?: DiscoveryContext;
	/** Account ID for scope isolation */
	accountId?: string;
	/** Base URL for scope isolation */
	baseUrl?: string;
	/** Data directory for cache persistence */
	dataDir?: string;
	/** Whether the discovery result should be authoritative (hide unmatched bundled models) */
	authoritative?: boolean;
	/** Override the discovery function (for testing) */
	discoverModels?: DiscoverModelsFn;
	/** Current timestamp in ms (for testing) */
	nowMs?: number;
}

export interface ResolvedModelCatalog {
	/** Merged models: bundled + cache + fresh discovery */
	models: ModelInfo[];
	/** Whether a fresh discovery result was used */
	discoveryUsed: boolean;
	/** Whether the discovery was authoritative */
	authoritative: boolean;
	/** The scope key used for cache lookup/storage */
	scopeKey: string;
	/** The cache entry after resolution (for persistence) */
	cacheEntry: ModelCatalogCacheEntry;
}

/**
 * Resolve the full model catalog for a provider, merging:
 * 1. Bundled models (static baseline from getProviderModels)
 * 2. Cached models from a previous successful discovery (if unexpired / last-good)
 * 3. Fresh discovery result (if available; wins by ID on conflict)
 *
 * When `authoritative` is true, models not present in the discovery result are
 * hidden (including bundled-only models). This is for providers like Codex or
 * OpenRouter where the live list is the ground truth.
 *
 * Cache is always updated with the best-known models after resolution.
 * If discovery fails, the last-good cache is preserved.
 */
export async function resolveModelCatalog(
	options: ResolveModelCatalogOptions,
): Promise<ResolvedModelCatalog> {
	const {
		providerId,
		credentialContext,
		accountId,
		baseUrl,
		dataDir,
		authoritative = false,
		discoverModels = discoverProviderModels,
		nowMs = Date.now(),
	} = options;

	const scope: CacheScope = { providerId, accountId, baseUrl };
	const scopeKey = computeScopeKey(scope);

	const store = new ModelCatalogStore(dataDir);

	// 1. Bundled models
	const bundled = getProviderModels(providerId);

	// 2. Cached models
	const cachedEntry = store.getEntry(scopeKey);
	const cached = cachedEntry?.models.map(hydrateCachedModel) ?? [];

	// 3. Fresh discovery
	let fresh: ModelInfo[] = [];
	let discoverySucceeded = false;
	try {
		const result = await discoverModels(providerId, credentialContext ?? {});
		if (result?.models && result.models.length > 0) {
			fresh = result.models;
			discoverySucceeded = true;
		}
	} catch {
		// Discovery failed: retain cached data, don't update fresh.
	}

	// 4. Merge: fresh overrides by ID, then cache fills gaps, bundled is baseline
	const byId: Record<string, ModelInfo> = {};
	for (const m of bundled) byId[m.id] = m;
	for (const m of cached) byId[m.id] = m;
	for (const m of fresh) byId[m.id] = m;

	let models: ModelInfo[];
	if (authoritative && discoverySucceeded) {
		const freshIds = new Set(fresh.map((m) => m.id));
		models = Object.values(byId).filter((m) => freshIds.has(m.id));
	} else {
		models = Object.values(byId);
	}

	// 5. Update cache
	const mergedRecords: CachedModelRecord[] = models.map((m) => {
		const record: CachedModelRecord = { id: m.id, name: m.name, updatedAt: nowMs };
		if (m.contextWindow !== undefined) record.contextWindow = m.contextWindow;
		if (m.supportsTools !== undefined) record.supportsTools = m.supportsTools;
		if (m.supportedInputs !== undefined) record.supportedInputs = m.supportedInputs;
		return record;
	});
	const newEntry: ModelCatalogCacheEntry = {
		scopeKey,
		providerId,
		accountId,
		baseUrl,
		models: mergedRecords,
		fetchedAt: nowMs,
		authoritative: authoritative && discoverySucceeded,
		version: CACHE_VERSION,
	};

	store.upsertEntry(newEntry);
	store.close();

	return {
		models,
		discoveryUsed: discoverySucceeded,
		authoritative: authoritative && discoverySucceeded,
		scopeKey,
		cacheEntry: newEntry,
	};
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeBaseUrl(url: string): string {
	try {
		const u = new URL(url.trim());
		u.pathname = u.pathname.replace(/\/+$/, '');
		return u.toString().replace(/\/+$/, '').toLowerCase();
	} catch {
		return url.trim().toLowerCase();
	}
}

// ── Convenience: resolve without discovery (cache + bundled only) ────────────

/**
 * Resolve models from cache + bundled only, without triggering discovery.
 * Useful for UI that needs a quick list while discovery runs in background.
 */
export function resolveCachedModelCatalog(
	providerId: string,
	options?: { accountId?: string; baseUrl?: string; dataDir?: string },
): ModelInfo[] {
	const scope: CacheScope = {
		providerId,
		accountId: options?.accountId,
		baseUrl: options?.baseUrl,
	};
	const scopeKey = computeScopeKey(scope);

	const store = new ModelCatalogStore(options?.dataDir);
	const cachedEntry = store.getEntry(scopeKey);
	store.close();

	const bundled = getProviderModels(providerId);
	const cached = cachedEntry?.models.map(hydrateCachedModel) ?? [];

	const byId: Record<string, ModelInfo> = {};
	for (const m of bundled) byId[m.id] = m;
	for (const m of cached) byId[m.id] = m;
	return Object.values(byId);
}
