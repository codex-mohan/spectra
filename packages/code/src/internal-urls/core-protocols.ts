import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Message } from '@mohanscodex/spectra-ai';
import { backgroundTasks } from '../services/background-tasks.js';
import { loadContext } from '../services/context.js';
import { getMemoryFileSpec, type MemoryTarget } from '../services/memory.js';
import { loadAllSkills } from '../services/skill-catalog.js';
import { ArtifactStore } from './artifact-store.js';
import { readFilesystemResource, resolveContainedPath } from './filesystem-resource.js';
import { queryJson } from './json-query.js';
import type { InternalResource, InternalUrl, NamedResource, ProtocolHandler, ResolveContext, UrlCompletion } from './types.js';

function resourceName(url: InternalUrl): string {
	return url.rawHost || url.hostname;
}

function resourcePath(url: InternalUrl): string {
	return decodeURIComponent((url.rawPathname || url.pathname).replace(/^\//, ''));
}

function textResource(url: string, content: string, contentType: InternalResource['contentType'] = 'text/plain'): InternalResource {
	return { url, content, contentType, size: Buffer.byteLength(content) };
}

function formatMessage(message: Message): unknown {
	return message;
}

export class SkillProtocolHandler implements ProtocolHandler {
	readonly scheme = 'skill';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const name = resourceName(url);
		const skills = context.skills ?? await loadAllSkills();
		if (!name) {
			const content = [...skills.values()]
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((skill) => `${skill.name}${skill.description ? ` — ${skill.description}` : ''}`)
				.join('\n');
			return { ...textResource(url.href, content), isDirectory: true };
		}
		const skill = skills.get(name) ?? [...skills.values()].find((candidate) => candidate.name === name);
		if (!skill) throw new Error(`Unknown skill: ${name}\nAvailable: ${[...skills.keys()].sort().join(', ') || 'none'}`);
		const child = resourcePath(url);
		if (!child) return { ...textResource(url.href, skill.content, 'text/markdown'), sourcePath: path.join(skill.location, 'SKILL.md') };
		return readFilesystemResource(url.href, resolveContainedPath(skill.location, child), true);
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		const skills = context.skills ?? await loadAllSkills();
		return [...skills.values()].map((skill) => ({ value: skill.name, description: skill.description }));
	}
}

export class RuleProtocolHandler implements ProtocolHandler {
	readonly scheme = 'rule';
	readonly immutable = true;

	async #rules(context: ResolveContext): Promise<Map<string, NamedResource>> {
		if (context.rules) return new Map(context.rules);
		const rules = new Map<string, NamedResource>();
		for (const source of loadContext(context.cwd, { includeSystemPrompt: false }).sources) {
			const base = path.basename(source.path, path.extname(source.path));
			let name = base.toLowerCase();
			let suffix = 2;
			while (rules.has(name)) name = `${base.toLowerCase()}-${suffix++}`;
			rules.set(name, { name, content: source.content, description: source.path, contentType: 'text/markdown' });
		}
		return rules;
	}

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const rules = await this.#rules(context);
		const name = resourceName(url);
		if (!name) {
			return { ...textResource(url.href, [...rules.values()].map((rule) => `${rule.name}${rule.description ? ` — ${rule.description}` : ''}`).join('\n')), isDirectory: true };
		}
		const rule = rules.get(name);
		if (!rule) throw new Error(`Unknown rule: ${name}\nAvailable: ${[...rules.keys()].join(', ') || 'none'}`);
		return textResource(url.href, rule.content, rule.contentType ?? 'text/markdown');
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		return [...(await this.#rules(context)).values()].map((rule) => ({ value: rule.name, description: rule.description }));
	}
}

export class MemoryProtocolHandler implements ProtocolHandler {
	readonly scheme = 'memory';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const target = (resourceName(url) || 'project') as MemoryTarget;
		if (!['memory', 'user', 'project'].includes(target)) throw new Error('memory:// expects memory, user, or project');
		const spec = getMemoryFileSpec(target, context.cwd);
		try {
			return await readFilesystemResource(url.href, spec.path, true);
		} catch (error) {
			if ((error as Error).message.startsWith('Resource not found:')) return textResource(url.href, '', 'text/markdown');
			throw error;
		}
	}

	async complete(): Promise<UrlCompletion[]> {
		return ['project', 'user', 'memory'].map((value) => ({ value }));
	}
}

export class LocalProtocolHandler implements ProtocolHandler {
	readonly scheme = 'local';
	readonly immutable = false;

	#target(url: InternalUrl, context: ResolveContext): string {
		const root = context.localDir ?? path.join(context.cwd, '.spectra', 'local');
		const relativePath = [resourceName(url), resourcePath(url)].filter(Boolean).join('/');
		return resolveContainedPath(root, relativePath);
	}

	resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		return readFilesystemResource(url.href, this.#target(url, context), false);
	}

	async write(url: InternalUrl, content: string, context: ResolveContext): Promise<void> {
		const target = this.#target(url, context);
		await fs.mkdir(path.dirname(target), { recursive: true });
		await fs.writeFile(target, content, { encoding: 'utf8', mode: 0o600 });
	}
}

export class ArtifactProtocolHandler implements ProtocolHandler {
	readonly scheme = 'artifact';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const id = resourceName(url);
		if (!/^\d+$/.test(id)) throw new Error(`artifact:// requires a numeric ID, got: ${id || '(empty)'}`);
		const store = new ArtifactStore(context.artifactDir ?? path.join(context.cwd, '.spectra', 'artifacts'));
		const artifactPath = await store.pathFor(id);
		if (!artifactPath) throw new Error(`Artifact ${id} not found. Available: ${(await store.list()).join(', ') || 'none'}`);
		return readFilesystemResource(url.href, artifactPath, true);
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		const store = new ArtifactStore(context.artifactDir ?? path.join(context.cwd, '.spectra', 'artifacts'));
		return (await store.list()).map((value) => ({ value }));
	}
}

export class AgentProtocolHandler implements ProtocolHandler {
	readonly scheme = 'agent';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const id = resourceName(url);
		if (!id) throw new Error('agent:// requires a task or child-session ID');
		const task = backgroundTasks.get(id);
		const session = context.sessionStore?.get(id);
		if (!task && !session) throw new Error(`Agent output not found: ${id}`);
		const value: unknown = task
			? { id: task.id, status: task.status, agentType: task.agentType, description: task.description, result: task.result, error: task.error, messages: task.messages?.map(formatMessage) }
			: { id: session!.id, title: session!.title, agent: session!.agent, parentId: session!.parentId, messages: session!.messages.map(formatMessage) };
		const extraction = resourcePath(url) || url.searchParams.get('q');
		const selected = extraction ? queryJson(value, extraction) : value;
		return textResource(url.href, JSON.stringify(selected, null, 2), 'application/json');
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		const ids = new Set(backgroundTasks.getAll().map((task) => task.id));
		for (const session of context.sessionStore?.list(context.cwd) ?? []) {
			if (session.parentId) ids.add(session.id);
		}
		return [...ids].sort().map((value) => ({ value }));
	}
}

export class HistoryProtocolHandler implements ProtocolHandler {
	readonly scheme = 'history';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		if (!context.sessionStore) throw new Error('Session history is unavailable');
		const id = resourceName(url) || context.sessionId;
		if (!id) {
			return { ...textResource(url.href, JSON.stringify(context.sessionStore.list(context.cwd), null, 2), 'application/json'), isDirectory: true };
		}
		const session = context.sessionStore.get(id);
		if (!session) throw new Error(`Session not found: ${id}`);
		const extraction = resourcePath(url) || url.searchParams.get('q');
		const value = extraction ? queryJson(session, extraction) : session;
		return textResource(url.href, JSON.stringify(value, null, 2), 'application/json');
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		return (context.sessionStore?.list(context.cwd) ?? []).map((session) => ({ value: session.id, label: session.title, description: session.agent }));
	}
}

export class SpectraProtocolHandler implements ProtocolHandler {
	readonly scheme = 'spectra';
	readonly immutable = true;
	readonly #root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const name = resourceName(url);
		const child = resourcePath(url);
		if (!name) {
			return { ...textResource(url.href, 'readme\nagents\ndocs/'), isDirectory: true };
		}
		if (name === 'readme') return readFilesystemResource(url.href, path.join(this.#root, 'README.md'), true);
		if (name === 'agents') return readFilesystemResource(url.href, path.join(this.#root, 'AGENTS.md'), true);
		if (name === 'docs') return readFilesystemResource(url.href, resolveContainedPath(path.join(this.#root, 'docs'), child), true);
		throw new Error(`Unknown Spectra resource: ${name}`);
	}

	async complete(): Promise<UrlCompletion[]> {
		return [{ value: 'readme' }, { value: 'agents' }, { value: 'docs' }];
	}
}
