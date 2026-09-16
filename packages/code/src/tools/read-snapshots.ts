import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { InMemorySnapshotStore, type SnapshotStore } from './hashline/index.js';

export const SNAPSHOT_MAX_BYTES = 4 * 1024 * 1024;

export class ReadSnapshotStore {
	readonly store: SnapshotStore;

	constructor(store: SnapshotStore = new InMemorySnapshotStore()) {
		this.store = store;
	}

	async record(filePath: string, content: string, seenLines: Iterable<number>): Promise<string | undefined> {
		if (Buffer.byteLength(content) > SNAPSHOT_MAX_BYTES) return undefined;
		return this.store.record(await this.canonicalPath(filePath), content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n'), seenLines);
	}

	async canonicalPath(filePath: string): Promise<string> {
		try {
			return await fs.realpath(filePath);
		} catch {
			try {
				return path.join(await fs.realpath(path.dirname(filePath)), path.basename(filePath));
			} catch {
				return path.resolve(filePath);
			}
		}
	}
}
