import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ARTIFACT_FILE = /^(\d+)\.([a-z0-9_-]+)$/i;

export class ArtifactStore {
	constructor(readonly directory: string) {}

	async put(content: string, extension = 'txt'): Promise<string> {
		await fs.mkdir(this.directory, { recursive: true });
		const files = await fs.readdir(this.directory);
		let highest = -1;
		for (const file of files) {
			const match = ARTIFACT_FILE.exec(file);
			if (match) highest = Math.max(highest, Number(match[1]));
		}
		const id = String(highest + 1);
		const safeExtension = extension.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'txt';
		await fs.writeFile(path.join(this.directory, `${id}.${safeExtension}`), content, { encoding: 'utf8', mode: 0o600 });
		return id;
	}

	async pathFor(id: string): Promise<string | undefined> {
		if (!/^\d+$/.test(id)) return undefined;
		let files: string[];
		try {
			files = await fs.readdir(this.directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}
		const match = files.find((file) => file.startsWith(`${id}.`) && ARTIFACT_FILE.test(file));
		return match ? path.join(this.directory, match) : undefined;
	}

	async list(): Promise<string[]> {
		try {
			const files = await fs.readdir(this.directory);
			return files
				.map((file) => ARTIFACT_FILE.exec(file)?.[1])
				.filter((id): id is string => id !== undefined)
				.sort((left, right) => Number(left) - Number(right));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw error;
		}
	}
}
