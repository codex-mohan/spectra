import type { AgentTool, ToolResult } from '../types.js';
import type { Skill, SkillIndex } from '../skill.js';
import { loadSkillContent, getSkillDescription, formatSkillCatalogEntry, buildIndex, matchSkills } from '../skill.js';
import { incrementUseCount } from '../skill-store.js';

export function createSkillTool(skills: Map<string, Skill>): AgentTool {
	return {
		name: 'skill',
		description: `Load a specialized skill by name. Use find_skills first to discover available skills, then call this to load the full instructions. The skill name must match one listed by find_skills.`,
		parameters: {
			type: 'object',
			properties: {
				name: {
					type: 'string',
					description: 'The exact skill name (as listed by find_skills)',
				},
				args: {
					type: 'string',
					description: 'Optional arguments to pass to the skill ($ARGUMENTS substitution)',
				},
			},
			required: ['name'],
		},
		execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> => {
			const name = args.name as string;
			const skillArgs = (args.args as string) ?? '';

			const skill = skills.get(name);
			if (!skill) {
				const available = Array.from(skills.keys()).join(', ');
				return {
					content: [{ type: 'text', text: `Skill "${name}" not found. Available skills: ${available}` }],
					isError: true,
				};
			}

			const content = await loadSkillContent(skill, skillArgs);

			// Track usage for evolving skills (fire and forget)
			incrementUseCount(skill.name).catch(() => {});

			const fileList = skill.files.length > 0
				? `\n\n<skill_files>\n${skill.files.map((f) => `<file>${f}</file>`).join('\n')}\n</skill_files>`
				: '';

			return {
				content: [{
					type: 'text',
					text: `<skill_content name="${skill.name}">\n# Skill: ${skill.name}\n\n${content}\n\nBase directory for this skill: file://${skill.location}\nRelative paths in this skill (e.g., scripts/, references/) are relative to this base directory.${fileList}\n</skill_content>`,
				}],
			};
		},
	};
}

export function createFindSkillsTool(skills: Map<string, Skill>): AgentTool {
	let cachedIndex: SkillIndex | null = null;

	function getIndex(): SkillIndex {
		if (!cachedIndex) {
			cachedIndex = buildIndex([...skills.values()]);
		}
		return cachedIndex;
	}

	return {
		name: 'find_skills',
		description: `Discover available skills. Pass a query to search by topic/task, or set all=true to browse the full catalog. Use this before loading a skill with the skill tool.`,
		parameters: {
			type: 'object',
			properties: {
				query: {
					type: 'string',
					description: 'Search query (e.g. "deploy vercel", "debug typescript", "write tests")',
				},
				all: {
					type: 'boolean',
					description: 'Set true to list ALL available skills (fallback when query returns nothing)',
				},
			},
		},
		execute: async (_toolCallId: string, args: Record<string, unknown>): Promise<ToolResult> => {
			const query = (args.query as string) ?? '';
			const showAll = (args.all as boolean) ?? false;

			if (skills.size === 0) {
				return {
					content: [{ type: 'text', text: 'No skills available. Skills are loaded from .claude/skills/, .agents/skills/, ~/.claude/skills/, and ~/.agents/skills/.' }],
				};
			}

			// All mode: return full catalog
			if (showAll) {
				const lines = Array.from(skills.values()).map((s) => formatSkillCatalogEntry(s));
				return {
					content: [{
						type: 'text',
						text: `<skill_catalog count="${skills.size}">\nAvailable skills. Load one with the skill tool:\n\n${lines.join('\n')}\n</skill_catalog>`,
					}],
				};
			}

			// Query mode: TF-IDF search
			if (!query) {
				return {
					content: [{ type: 'text', text: 'Provide a query string to search skills, or set all=true to list everything.' }],
				};
			}

			const index = getIndex();
			const matches = matchSkills(query, index, { topK: 10, threshold: 0.03 });

			if (matches.length === 0) {
				const lines = Array.from(skills.values()).map((s) => formatSkillCatalogEntry(s));
				return {
					content: [{
						type: 'text',
						text: `No skills matched "${query}". Here are all available skills:\n\n<skill_catalog count="${skills.size}">\n${lines.join('\n')}\n</skill_catalog>`,
					}],
				};
			}

			const resultLines = matches.map((m) => {
				const desc = getSkillDescription(m.skill);
				const tags = m.skill.tags.length > 0 ? ` [${m.skill.tags.slice(0, 5).join(', ')}]` : '';
				return `- ${m.skill.name} — ${desc}${tags} (score: ${m.score.toFixed(3)})`;
			});

			return {
				content: [{
					type: 'text',
					text: `<skill_matches query="${query}" count="${matches.length}">\n${resultLines.join('\n')}\n</skill_matches>`,
				}],
			};
		},
	};
}
