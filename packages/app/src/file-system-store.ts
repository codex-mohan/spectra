import { readFile, writeFile, mkdir, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { Session, SessionFilter, SessionStore } from './types.js';

export class FileSystemSessionStore implements SessionStore {
	constructor(private sessionsDir: string) {}

	private getPath(id: string): string {
		return join(this.sessionsDir, `${id}.json`);
	}

	async create(session: Session): Promise<Session> {
		await this.ensureDir();
		await writeFile(this.getPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
		return session;
	}

	async load(id: string): Promise<Session | null> {
		const path = this.getPath(id);
		if (!existsSync(path)) return null;

		try {
			const raw = await readFile(path, 'utf-8');
			const session = JSON.parse(raw) as Session;
			// Restore Date objects from ISO strings
			if (session.metadata?.createdAt) {
				session.metadata.createdAt = new Date(session.metadata.createdAt);
			}
			if (session.metadata?.updatedAt) {
				session.metadata.updatedAt = new Date(session.metadata.updatedAt);
			}
			return session;
		} catch {
			return null;
		}
	}

	async save(session: Session): Promise<void> {
		await this.ensureDir();
		await writeFile(this.getPath(session.id), JSON.stringify(session, null, 2), 'utf-8');
	}

	async delete(id: string): Promise<void> {
		const path = this.getPath(id);
		if (existsSync(path)) {
			await unlink(path);
		}
	}

	async list(filter?: SessionFilter): Promise<Session[]> {
		if (!existsSync(this.sessionsDir)) return [];

		const entries = await readdir(this.sessionsDir);
		const sessions: Session[] = [];

		for (const entry of entries) {
			if (!entry.endsWith('.json')) continue;
			const id = entry.replace('.json', '');
			const session = await this.load(id);
			if (session) sessions.push(session);
		}

		return this.applyFilter(sessions, filter);
	}

	private async ensureDir(): Promise<void> {
		if (!existsSync(this.sessionsDir)) {
			await mkdir(this.sessionsDir, { recursive: true });
		}
	}

	private applyFilter(sessions: Session[], filter?: SessionFilter): Session[] {
		let result = sessions;

		if (filter?.userId) {
			result = result.filter((s) => s.metadata.userId === filter.userId);
		}

		if (filter?.tenantId) {
			result = result.filter((s) => s.metadata.tenantId === filter.tenantId);
		}

		if (filter?.status) {
			result = result.filter((s) => {
				if (filter.status === 'active') return s.metadata.isStreaming;
				if (filter.status === 'completed') return !s.metadata.isStreaming && !s.metadata.error;
				if (filter.status === 'error') return s.metadata.error;
				return true;
			});
		}

		// Sort by updatedAt descending (most recent first)
		result.sort((a, b) => new Date(b.metadata.updatedAt).getTime() - new Date(a.metadata.updatedAt).getTime());

		if (filter?.offset) {
			result = result.slice(filter.offset);
		}

		if (filter?.limit) {
			result = result.slice(0, filter.limit);
		}

		return result;
	}
}
