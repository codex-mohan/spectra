import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { discoverSkills, type Skill } from '@mohanscodex/spectra-agent';
import { loadAllEvolvingSkills } from './skill-store.js';

let cached: Map<string, Skill> | null = null;

/**
 * Load the full merged skill catalog: bundled → evolving → user/project.
 * Cached per process; call invalidateSkillCatalog() after skill mutations.
 */
export async function loadAllSkills(): Promise<Map<string, Skill>> {
	if (cached) return cached;

	const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
	const bundledSkillsDir = resolve(packageRoot, 'skills');

	const bundled = await discoverSkills({ customPaths: [bundledSkillsDir] });
	const evolving = await loadAllEvolvingSkills();
	const user = await discoverSkills();

	const merged = new Map<string, Skill>();
	for (const [name, skill] of bundled) merged.set(name, skill);
	for (const skill of evolving) merged.set(skill.name, skill);
	for (const [name, skill] of user) merged.set(name, skill);

	cached = merged;
	return cached;
}

export function invalidateSkillCatalog(): void {
	cached = null;
}
