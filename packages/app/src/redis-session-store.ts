import type { Session, SessionFilter, SessionStore, RedisClient } from './types.js';

export interface RedisSessionStoreConfig {
	ttlSeconds: number;
	keyPrefix: string;
	coldStore?: SessionStore;
}

export class RedisSessionStore implements SessionStore {
	private redis: RedisClient;
	private config: RedisSessionStoreConfig;

	constructor(redis: RedisClient, config?: Partial<RedisSessionStoreConfig>) {
		this.redis = redis;
		this.config = {
			ttlSeconds: config?.ttlSeconds ?? 3600,
			keyPrefix: config?.keyPrefix ?? 'session',
			coldStore: config?.coldStore,
		};
	}

	private key(id: string): string {
		return `${this.config.keyPrefix}:${id}`;
	}

	async create(session: Session): Promise<Session> {
		await this.setSession(session);

		if (this.config.coldStore) {
			await this.config.coldStore.create(session);
		}

		return session;
	}

	async load(id: string): Promise<Session | null> {
		const raw = await this.redis.get(this.key(id));
		if (raw) {
			return JSON.parse(raw) as Session;
		}

		if (this.config.coldStore) {
			const session = await this.config.coldStore.load(id);
			if (session) {
				await this.setSession(session);
				return session;
			}
		}

		return null;
	}

	async save(session: Session): Promise<void> {
		await this.setSession(session);

		if (this.config.coldStore) {
			await this.config.coldStore.save(session);
		}
	}

	async delete(id: string): Promise<void> {
		await this.redis.del(this.key(id));

		if (this.config.coldStore) {
			await this.config.coldStore.delete(id);
		}
	}

	async list(filter?: SessionFilter): Promise<Session[]> {
		if (this.config.coldStore) {
			return this.config.coldStore.list(filter);
		}

		throw new Error('RedisSessionStore.list() requires a coldStore. Redis KEYS should not be used in production.');
	}

	private async setSession(session: Session): Promise<void> {
		const serialized = JSON.stringify(session);
		await this.redis.set(this.key(session.id), serialized, 'EX', this.config.ttlSeconds);
	}
}
