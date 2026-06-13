import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Skill } from './skill.js';

export interface EvolvingSkillMeta {
	id: string;
	name: string;
	description: string;
	whenToUse: string;
	tags: string[];
	useCount: number;
	version: number;
	parentId?: string;
	createdAt: string;
	updatedAt: string;
	origin: 'learned' | 'evolved';
}

function getSpectraDir(): string {
	return process.env.SPECTRA_HOME || path.join(homedir(), '.spectra');
}

function getSkillsDir(): string {
	return path.join(getSpectraDir(), 'skills');
}

function getSkillDir(id: string): string {
	return path.join(getSkillsDir(), id);
}

function getMetadataPath(id: string): string {
	return path.join(getSkillDir(id), 'metadata.json');
}

function getSkillMdPath(id: string): string {
	return path.join(getSkillDir(id), 'SKILL.md');
}

function isValidSkillId(id: string): boolean {
	return /^[a-z0-9][a-z0-9-]{1,79}$/.test(id);
}

export async function ensureSkillsDir(): Promise<void> {
	const dir = getSkillsDir();
	if (!existsSync(dir)) {
		await fs.mkdir(dir, { recursive: true });
	}
}

export async function saveEvolvingSkill(skill: EvolvingSkillMeta, content: string): Promise<void> {
	await ensureSkillsDir();
	const dir = getSkillDir(skill.id);
	if (!existsSync(dir)) {
		await fs.mkdir(dir, { recursive: true });
	}
	await fs.writeFile(getMetadataPath(skill.id), JSON.stringify(skill, null, 2), 'utf-8');
	await fs.writeFile(getSkillMdPath(skill.id), content, 'utf-8');
}

export async function loadEvolvingSkill(id: string): Promise<{ meta: EvolvingSkillMeta; content: string } | null> {
	if (!isValidSkillId(id)) return null;

	const metaPath = getMetadataPath(id);
	if (existsSync(metaPath)) {
		try {
			const raw = await fs.readFile(metaPath, 'utf-8');
			const meta = JSON.parse(raw) as EvolvingSkillMeta;
			const content = await fs.readFile(getSkillMdPath(id), 'utf-8');
			return { meta, content };
		} catch {
			return null;
		}
	}
	return null;
}

export async function loadAllEvolvingSkills(): Promise<Skill[]> {
	const dir = getSkillsDir();
	if (!existsSync(dir)) return [];

	const skills: Skill[] = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const loaded = await loadEvolvingSkill(entry.name);
			if (loaded) {
				skills.push({
					name: loaded.meta.name,
					description: loaded.meta.description,
					whenToUse: loaded.meta.whenToUse,
					location: getSkillDir(entry.name),
					content: loaded.content,
					files: [],
					tags: loaded.meta.tags,
				});
			}
		}
	} catch {
		// Skip unreadable directories
	}
	return skills;
}

export async function incrementUseCount(id: string): Promise<void> {
	const loaded = await loadEvolvingSkill(id);
	if (!loaded) return;
	loaded.meta.useCount++;
	loaded.meta.updatedAt = new Date().toISOString();
	await saveEvolvingSkill(loaded.meta, loaded.content);
}

export async function findSimilarSkill(
	name: string,
	description: string,
	whenToUse: string,
	existingSkills: Skill[],
): Promise<Skill | null> {
	if (existingSkills.length === 0) return null;

	const { buildIndex, matchSkills } = await import('./skill.js');
	const index = buildIndex(existingSkills);
	const queryText = [name, description, whenToUse].join(' ');
	const matches = matchSkills(queryText, index, { topK: 1, threshold: 0.3 });
	return matches.length > 0 ? matches[0].skill : null;
}

export async function evolveSkill(
	existingId: string,
	updates: Partial<EvolvingSkillMeta>,
	content: string,
): Promise<void> {
	const loaded = await loadEvolvingSkill(existingId);
	if (!loaded) return;

	const updated: EvolvingSkillMeta = {
		...loaded.meta,
		...updates,
		version: loaded.meta.version + 1,
		updatedAt: new Date().toISOString(),
		origin: 'evolved',
	};
	await saveEvolvingSkill(updated, content);
}

export async function forkSkill(
	parentId: string,
	newId: string,
	newName: string,
	content: string,
): Promise<void> {
	if (!isValidSkillId(newId)) return;

	const meta: EvolvingSkillMeta = {
		id: newId,
		name: newName,
		description: '',
		whenToUse: '',
		tags: [],
		useCount: 0,
		version: 1,
		parentId,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		origin: 'learned',
	};
	await saveEvolvingSkill(meta, content);
}
