import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SkillMetadata {
	name: string;
	description?: string;
	whenToUse?: string;
	allowedTools?: string[];
	disallowedTools?: string[];
	model?: string;
	effort?: string;
	context?: 'fork';
	version?: string;
}

export interface Skill extends SkillMetadata {
	location: string;
	content: string;
	files: string[];
	tags: string[];
}

export interface SkillDiscoveryOptions {
	projectRoot?: string;
	homeDir?: string;
	customPaths?: string[];
}

const SKILL_FILE = 'SKILL.md';

async function fileExists(p: string): Promise<boolean> {
	try {
		await fs.access(p);
		return true;
	} catch {
		return false;
	}
}

async function readSkillFile(skillDir: string): Promise<Skill | null> {
	const skillPath = path.join(skillDir, SKILL_FILE);
	if (!(await fileExists(skillPath))) return null;

	const content = await fs.readFile(skillPath, 'utf-8');
	const parsed = parseSkillFrontmatter(content);

	const files: string[] = [];
	try {
		const entries = await fs.readdir(skillDir, { withFileTypes: true });
		for (const entry of entries) {
			if (entry.name === SKILL_FILE) continue;
			if (entry.isDirectory()) {
				const subFiles = await readDirRecursive(path.join(skillDir, entry.name));
				files.push(...subFiles.map((f) => path.relative(skillDir, f)));
			} else {
				files.push(entry.name);
			}
		}
	} catch {
		// Directory read failed, return what we have
	}

	return {
		...parsed,
		location: skillDir,
		content,
		files,
		tags: extractTags(parsed.name, skillDir, parsed, content),
	};
}

async function readDirRecursive(dir: string): Promise<string[]> {
	const results: string[] = [];
	try {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				results.push(...await readDirRecursive(fullPath));
			} else {
				results.push(fullPath);
			}
		}
	} catch {
		// Ignore read errors
	}
	return results;
}

function parseSkillFrontmatter(content: string): SkillMetadata {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match) return { name: '' };

	const yaml = match[1];
	const meta: SkillMetadata = { name: '' };

	for (const line of yaml.split(/\r?\n/)) {
		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();

		switch (key) {
			case 'name':
				meta.name = value;
				break;
			case 'description':
				meta.description = value;
				break;
			case 'when_to_use':
				meta.whenToUse = value;
				break;
			case 'allowed-tools':
				meta.allowedTools = value.split(/\s+/).filter(Boolean);
				break;
			case 'disallowed-tools':
				meta.disallowedTools = value.split(/\s+/).filter(Boolean);
				break;
			case 'model':
				meta.model = value;
				break;
			case 'effort':
				meta.effort = value;
				break;
			case 'context':
				meta.context = value as 'fork';
				break;
			case 'version':
				meta.version = value;
				break;
		}
	}

	return meta;
}

// ── Auto-tag extraction ──────────────────────────────────────────────

const STOP_WORDS = new Set([
	'the', 'and', 'for', 'that', 'this', 'with', 'from', 'are', 'was',
	'were', 'been', 'have', 'has', 'had', 'but', 'not', 'you', 'all',
	'can', 'her', 'his', 'one', 'our', 'out', 'use', 'how', 'its',
	'let', 'may', 'who', 'did', 'get', 'she', 'him', 'old', 'see',
	'now', 'way', 'each', 'make', 'like', 'than', 'them', 'then',
	'what', 'when', 'will', 'more', 'some', 'just', 'also', 'into',
	'over', 'such', 'take', 'only', 'very', 'much', 'here', 'there',
	'these', 'those', 'about', 'would', 'could', 'should', 'other',
	'which', 'their', 'after', 'before', 'being', 'between', 'only',
]);

function extractTags(name: string, skillDir: string, meta: SkillMetadata, body: string): string[] {
	const tags = new Set<string>();

	// 1. Category from directory path (e.g., "debugging", "collaboration")
	const pathParts = skillDir.replace(/\\/g, '/').split('/');
	const skillsIdx = pathParts.findIndex((p) => p === 'skills');
	if (skillsIdx >= 0 && skillsIdx < pathParts.length - 1) {
		const category = pathParts[skillsIdx + 1];
		if (category && !category.startsWith('.')) tags.add(category.toLowerCase());
	}

	// 2. Name/ID segments (kebab-case → individual words)
	const slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '');
	for (const seg of slug.split(/[\s-]+/)) {
		if (seg.length > 2 && !STOP_WORDS.has(seg)) tags.add(seg);
	}

	// 3. Section headers from body (## Heading → heading words)
	const headers = body.match(/^#+\s+(.+)$/gm);
	if (headers) {
		for (const h of headers) {
			const text = h.replace(/^#+\s+/, '').toLowerCase();
			for (const word of text.split(/\s+/)) {
				const clean = word.replace(/[^a-z0-9]/g, '');
				if (clean.length > 3 && !STOP_WORDS.has(clean)) tags.add(clean);
			}
		}
	}

	// 4. Keywords from description and whenToUse
	for (const field of [meta.description, meta.whenToUse]) {
		if (!field) continue;
		const words = field.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
		for (const w of words) {
			if (w.length > 3 && !STOP_WORDS.has(w)) tags.add(w);
		}
	}

	return [...tags].slice(0, 30);
}

// ── TF-IDF Index ─────────────────────────────────────────────────────

export interface MatchResult {
	skill: Skill;
	score: number;
}

export interface SkillIndex {
	docCount: number;
	idf: Map<string, number>;
	vectors: Map<string, Map<string, number>>;
	skills: Map<string, Skill>;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length > 1 && !STOP_WORDS.has(w));
}

function computeTf(tokens: string[]): Map<string, number> {
	const freq = new Map<string, number>();
	for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
	const len = tokens.length || 1;
	const tf = new Map<string, number>();
	for (const [term, count] of freq) tf.set(term, count / len);
	return tf;
}

function computeIdf(allTokenSets: Map<string, string[]>): Map<string, number> {
	const df = new Map<string, number>();
	const totalDocs = allTokenSets.size;
	for (const [, tokens] of allTokenSets) {
		const unique = new Set(tokens);
		for (const t of unique) df.set(t, (df.get(t) ?? 0) + 1);
	}
	const idf = new Map<string, number>();
	for (const [term, docFreq] of df) {
		idf.set(term, Math.log((totalDocs + 1) / (docFreq + 1)) + 1);
	}
	return idf;
}

function buildVector(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
	const vec = new Map<string, number>();
	for (const [term, tfVal] of tf) {
		const idfVal = idf.get(term) ?? Math.log(2);
		vec.set(term, tfVal * idfVal);
	}
	return vec;
}

function skillToText(skill: Skill): string {
	const parts = [
		skill.name,
		skill.description ?? '',
		skill.whenToUse ?? '',
		...skill.tags,
		...skill.tags,
	];
	return parts.join(' ');
}

export function buildIndex(skills: Skill[]): SkillIndex {
	if (skills.length === 0) return { docCount: 0, idf: new Map(), vectors: new Map(), skills: new Map() };

	const allTokenSets = new Map<string, string[]>();
	const allTfs = new Map<string, Map<string, number>>();
	const skillMap = new Map<string, Skill>();

	for (const skill of skills) {
		const id = skill.name;
		const text = skillToText(skill);
		const tokens = tokenize(text);
		const tf = computeTf(tokens);
		allTfs.set(id, tf);
		allTokenSets.set(id, tokens);
		skillMap.set(id, skill);
	}

	const idf = computeIdf(allTokenSets);
	const vectors = new Map<string, Map<string, number>>();
	for (const [id, tf] of allTfs) vectors.set(id, buildVector(tf, idf));

	return { docCount: skills.length, idf, vectors, skills: skillMap };
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (const [term, val] of a) {
		normA += val * val;
		const bVal = b.get(term);
		if (bVal !== undefined) dot += val * bVal;
	}
	for (const [, val] of b) normB += val * val;
	if (normA === 0 || normB === 0) return 0;
	return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function matchSkills(
	query: string,
	index: SkillIndex,
	options: { topK?: number; threshold?: number } = {},
): MatchResult[] {
	const { topK = 5, threshold = 0.05 } = options;
	if (index.docCount === 0) return [];

	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) return [];

	const queryTf = computeTf(queryTokens);
	const queryVec = buildVector(queryTf, index.idf);
	const results: MatchResult[] = [];

	for (const [id, docVec] of index.vectors) {
		const score = cosineSimilarity(queryVec, docVec);
		if (score < threshold) continue;
		const skill = index.skills.get(id);
		if (!skill) continue;
		results.push({ skill, score });
	}

	results.sort((a, b) => b.score - a.score);
	return results.slice(0, topK);
}

// ── Index cache ──────────────────────────────────────────────────────

const indexCache = new Map<string, { index: SkillIndex; builtAt: number }>();
const INDEX_TTL_MS = 60_000;

export async function getSkillIndex(
	skillsOrProjectRoot: Map<string, Skill> | string,
): Promise<SkillIndex> {
	const now = Date.now();

	if (typeof skillsOrProjectRoot === 'string') {
		const root = skillsOrProjectRoot;
		const hit = indexCache.get(root);
		if (hit && now - hit.builtAt < INDEX_TTL_MS) return hit.index;
		const skills = await discoverSkills({ projectRoot: root });
		const index = buildIndex([...skills.values()]);
		indexCache.set(root, { index, builtAt: now });
		return index;
	}

	return buildIndex([...skillsOrProjectRoot.values()]);
}

export function invalidateSkillIndex(projectRoot?: string): void {
	if (projectRoot) indexCache.delete(projectRoot);
	else indexCache.clear();
}

export async function discoverSkills(options: SkillDiscoveryOptions = {}): Promise<Map<string, Skill>> {
	const skills = new Map<string, Skill>();
	const homeDir = options.homeDir ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
	const projectRoot = options.projectRoot ?? process.cwd();

	const searchPaths: string[] = [];

	// Project-level: .claude/skills/ and .agents/skills/
	searchPaths.push(
		path.join(projectRoot, '.claude', 'skills'),
		path.join(projectRoot, '.agents', 'skills'),
	);

	// User-level: ~/.claude/skills/ and ~/.agents/skills/
	if (homeDir) {
		searchPaths.push(
			path.join(homeDir, '.claude', 'skills'),
			path.join(homeDir, '.agents', 'skills'),
		);
	}

	// Custom paths
	if (options.customPaths) {
		searchPaths.push(...options.customPaths);
	}

	for (const searchPath of searchPaths) {
		if (!(await fileExists(searchPath))) continue;

		try {
			const entries = await fs.readdir(searchPath, { withFileTypes: true });
			for (const entry of entries) {
				if (!entry.isDirectory()) continue;
				const skillDir = path.join(searchPath, entry.name);
				const skill = await readSkillFile(skillDir);
				if (skill && skill.name) {
					skills.set(skill.name, skill);
				} else {
					// Category directory — scan subdirectories for SKILL.md
					try {
						const subEntries = await fs.readdir(skillDir, { withFileTypes: true });
						for (const sub of subEntries) {
							if (!sub.isDirectory()) continue;
							const subSkillDir = path.join(skillDir, sub.name);
							const subSkill = await readSkillFile(subSkillDir);
							if (subSkill && subSkill.name) {
								skills.set(subSkill.name, subSkill);
							}
						}
					} catch {
						// Skip unreadable subdirectories
					}
				}
			}
		} catch {
			// Skip unreadable directories
		}
	}

	return skills;
}

export function getSkillDescription(skill: Skill): string {
	const parts: string[] = [];
	if (skill.whenToUse) parts.push(skill.whenToUse);
	if (skill.description) parts.push(skill.description);
	return parts.join(' ') || `Skill: ${skill.name}`;
}

export function formatSkillCatalogEntry(skill: Skill): string {
	const desc = getSkillDescription(skill);
	const tags = skill.tags.length > 0 ? ` [${skill.tags.slice(0, 5).join(', ')}]` : '';
	return `- ${skill.name} — ${desc}${tags}`;
}

export function buildAvailableSkillsBlock(skills: Skill[]): string {
	if (skills.length === 0) return '';

	const lines = skills.map((s) => formatSkillCatalogEntry(s));

	return `## Available Skills\n${lines.join('\n')}`;
}

export function substituteVariables(
	template: string,
	args: string,
	skillDir: string,
): string {
	return template
		.replace(/\$ARGUMENTS/g, args)
		.replace(/\$0/g, args)
		.replace(/\$\{SPECTRA_SKILL_DIR\}/g, skillDir)
		.replace(/\$\{SPECTRA_SKILL_DIR\}/g, skillDir);
}

export async function loadSkillContent(
	skill: Skill,
	args: string,
): Promise<string> {
	let content = skill.content;

	// Remove frontmatter
	content = content.replace(/^---\n[\s\S]*?\n---\n*/, '');

	// Substitute variables
	content = substituteVariables(content, args, skill.location);

	return content;
}
