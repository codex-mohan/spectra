// ---------------------------------------------------------------------------
// Template loader — recursive async discovery, parsing, rendering, and
// conversion to CommandDefinition objects returning submit_prompt.
// ---------------------------------------------------------------------------

import { readFile, readdir } from 'fs/promises';
import { dirname, join, relative, resolve, normalize } from 'path';

import { getGlobalConfigDir } from '../utils/paths.js';
import { parseFrontmatter } from './frontmatter.js';
import { renderTemplate, type RenderContext } from './template-renderer.js';
import { gatherContext, type GatherContextResult } from './context-providers.js';
import { interpolateShellCommands } from './template-shell.js';
import type {
	TemplateDefinition,
	TemplateDiagnostic,
	ContextProviderKind,
} from './template-types.js';
import type {
	CommandDefinition,
	CommandContext,
	CommandResult,
	CommandAction,
} from './types.js';

// --- Result -------------------------------------------------------------------

export interface LoadTemplateResult {
	readonly templates: readonly TemplateDefinition[];
	readonly diagnostics: readonly TemplateDiagnostic[];
}

export interface LoadTemplateOptions {
	readonly shellExecution?: boolean;
}

/**
 * Load project `.spectra/commands`, Claude-compatible `.claude/commands`,
 * then the global Spectra configuration commands directory.
 */
export async function loadTemplateDefinitions(
	projectRoot: string,
	options: LoadTemplateOptions = {},
): Promise<LoadTemplateResult> {
	const diagnostics: TemplateDiagnostic[] = [];
	const seenPaths = new Set<string>();
	const templates: TemplateDefinition[] = [];
	const pathKey = (value: string) => {
		const key = normalize(value);
		return process.platform === 'win32' ? key.toLowerCase() : key;
	};

	// --- discover search locations (project first, then global) ---------------
	const locations = await discoverSearchLocations(projectRoot);

	for (const location of locations) {
		const mdFiles = await collectMarkdownFiles(location.commandsDir);

		for (const filePath of mdFiles) {
			const normalised = pathKey(filePath);
			if (seenPaths.has(normalised)) continue;
			seenPaths.add(normalised);
			const result = await parseTemplateFile(filePath, location);
			if (result.template !== null) {
				templates.push(result.template);
			}
			diagnostics.push(...result.diagnostics);
		}
	}

	return { templates, diagnostics };
}

/**
 * Convert parsed templates into `CommandDefinition` objects that return
 * `submit_prompt` actions.  Definitions are ordered so that project templates
 * precede builtins when merged into a `createRegistry()` call.
 */
export function templatesToCommands(
	templates: readonly TemplateDefinition[],
	projectRoot: string,
	options: LoadTemplateOptions = {},
): readonly CommandDefinition[] {
	return templates.map((tpl) => buildCommandDefinition(tpl, projectRoot, options.shellExecution !== false));
}

// --- Discovery ----------------------------------------------------------------

interface SearchLocation {
	readonly commandsDir: string;
	readonly dialect: 'spectra' | 'claude';
}

/**
 * Walk upward from `projectRoot` collecting Spectra and Claude command
 * directories, then append the global Spectra configuration directory.
 */
async function discoverSearchLocations(projectRoot: string): Promise<SearchLocation[]> {
	const locations: SearchLocation[] = [];
	const seen = new Set<string>();
	const add = (commandsDir: string, dialect: 'spectra' | 'claude') => {
		const key = process.platform === 'win32' ? normalize(commandsDir).toLowerCase() : normalize(commandsDir);
		if (!seen.has(key)) {
			seen.add(key);
			locations.push({ commandsDir, dialect });
		}
	};
	let current = resolve(projectRoot);

	while (true) {
		add(join(current, '.spectra', 'commands'), 'spectra');
		add(join(current, '.claude', 'commands'), 'claude');
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	add(join(getGlobalConfigDir(), 'commands'), 'spectra');
	return locations;
}

/** Recursively collect all `.md` files under `dir`.  Swallows missing dirs. */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
	const results: string[] = [];
	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return results;
	}

	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...await collectMarkdownFiles(full));
		} else if (entry.isFile() && entry.name.endsWith('.md')) {
			results.push(full);
		}
	}

	return results;
}

// --- Parsing & conversion -----------------------------------------------------

interface ParseResult {
	readonly template: TemplateDefinition | null;
	readonly diagnostics: readonly TemplateDiagnostic[];
}

async function parseTemplateFile(
	filePath: string,
	location: SearchLocation,
): Promise<ParseResult> {
	const diags: TemplateDiagnostic[] = [];

	// --- read file ------------------------------------------------------------
	let raw: string;
	try {
		raw = await readFile(filePath, 'utf-8');
	} catch (err) {
		diags.push({
			kind: 'load',
			sourcePath: filePath,
			message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}`,
		});
		return { template: null, diagnostics: diags };
	}

	// --- parse frontmatter ----------------------------------------------------
	const { frontmatter, bodyOffset, diagnostics: fmDiags } = parseFrontmatter(raw, filePath);
	diags.push(...fmDiags);

	if (frontmatter === null) {
		return { template: null, diagnostics: diags };
	}
	const content = raw.slice(bodyOffset);
	if (!content.trim()) {
		diags.push({ kind: 'validation', sourcePath: filePath, message: 'Template body must not be empty' });
		return { template: null, diagnostics: diags };
	}
	const validation = renderTemplate(content, filePath, {
		args: '',
		contextValues: new Map(),
		declaredProviders: frontmatter.contextProviders,
		dialect: location.dialect,
	});
	if (validation.diagnostics.length > 0) {
		diags.push(...validation.diagnostics);
		return { template: null, diagnostics: diags };
	}

	// --- derive name from path ------------------------------------------------
	// Name is the relative path from the `commands/` dir, without `.md`,
	// normalised to `/` for cross-platform portability.
	let relPath = relative(location.commandsDir, filePath).replace(/\\/g, '/');
	if (relPath.endsWith('.md')) {
		relPath = relPath.slice(0, -3);
	}
	const name = relPath;
	if (!name.split('/').every((segment) => /^[a-z0-9][a-z0-9_-]*$/i.test(segment))) {
		diags.push({
			kind: 'validation',
			sourcePath: filePath,
			message: 'Command file names may contain only letters, numbers, hyphens, and underscores',
		});
		return { template: null, diagnostics: diags };
	}

	const tpl: TemplateDefinition = {
		name,
		description: frontmatter.description || name.replaceAll(/[-_/]+/g, ' '),
		sourcePath: filePath,
		content,
		contextProviders: frontmatter.contextProviders,
		dialect: location.dialect,
	};

	return { template: tpl, diagnostics: diags };
}

// --- CommandDefinition conversion ---------------------------------------------

function buildCommandDefinition(
	tpl: TemplateDefinition,
	projectRoot: string,
	shellExecution: boolean,
): CommandDefinition {
	const { name, description, sourcePath, content, contextProviders, dialect } = tpl;

	return {
		id: `template:${normalize(sourcePath).replace(/\\/g, '/')}`,
		name,
		aliases: [],
		title: description,
		description,
		category: 'Templates',
		source: 'template',
		sourceInfo: {
			path: sourcePath,
			label: `Template: ${name}`,
		},
		execute: async (ctx: CommandContext): Promise<CommandResult> => {
			// --- gather context providers --------------------------------------
			let contextValues: ReadonlyMap<string, string> = new Map();
			if (contextProviders.length > 0) {
				const gathered: GatherContextResult = await gatherContext(contextProviders, projectRoot, sourcePath);
				if (gathered.diagnostics.length > 0) {
					return gathered.diagnostics.map((diagnostic): CommandAction => ({
						type: 'show_toast',
						message: `${name}: ${diagnostic.message}`,
						variant: 'error',
					}));
				}
				contextValues = gathered.values;
			}

			// --- render --------------------------------------------------------
			const renderCtx: RenderContext = {
				args: ctx.args,
				contextValues,
				declaredProviders: contextProviders,
				dialect,
			};
			const rendered = renderTemplate(content, sourcePath, renderCtx);
			if (rendered.diagnostics.length > 0) {
				return rendered.diagnostics.map((diagnostic): CommandAction => ({
					type: 'show_toast',
					message: `${name}: ${diagnostic.message}`,
					variant: 'error',
				}));
			}

			const interpolated = await interpolateShellCommands(rendered.text, sourcePath, projectRoot, shellExecution);
			if (interpolated.diagnostics.length > 0) {
				return interpolated.diagnostics.map((diagnostic): CommandAction => ({
					type: 'show_toast',
					message: `${name}: ${diagnostic.message}`,
					variant: 'error',
				}));
			}

			const action: CommandAction = {
				type: 'submit_prompt',
				text: interpolated.text,
			};
			return action;
		},
	};
}
