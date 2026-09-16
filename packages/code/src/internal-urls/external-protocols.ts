import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listConnectedServers, readServerResource } from '../integrations/mcp/client.js';
import { readFilesystemResource, resolveContainedPath } from './filesystem-resource.js';
import type { InternalResource, InternalUrl, ProtocolHandler, ResolveContext, UrlCompletion } from './types.js';

const execFileAsync = promisify(execFile);

function textResource(url: string, content: string, contentType: InternalResource['contentType'] = 'text/plain'): InternalResource {
	return { url, content, contentType, size: Buffer.byteLength(content) };
}

function templateMatches(uri: string, template: string): boolean {
	const escaped = template
		.split(/\{[^}]+\}/g)
		.map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		.join('.*');
	return new RegExp(`^${escaped}$`).test(uri);
}

export class McpProtocolHandler implements ProtocolHandler {
	readonly scheme = 'mcp';
	readonly immutable = true;

	async resolve(url: InternalUrl): Promise<InternalResource> {
		const servers = listConnectedServers();
		if (servers.length === 0) throw new Error('No MCP servers are connected');
		const rawHost = url.rawHost || url.hostname;
		const rawPath = url.rawPathname || url.pathname;
		const namedServer = servers.find((server) => server.name === rawHost);
		const uri = namedServer && rawPath && rawPath !== '/'
			? decodeURIComponent(rawPath.slice(1))
			: `${rawHost}${rawPath && rawPath !== '/' ? rawPath : ''}${url.search}${url.hash}`;
		if (!uri) {
			const listing = servers.flatMap((server) => server.resources.map((resource) => `${resource.uri} (${server.name})`)).join('\n');
			return { ...textResource(url.href, listing), isDirectory: true };
		}
		const server = namedServer ?? servers.find((candidate) =>
			candidate.resources.some((resource) => resource.uri === uri)
			|| candidate.resourceTemplates.some((template) => templateMatches(uri, template.uriTemplate))
		);
		if (!server) {
			const available = servers.flatMap((candidate) => candidate.resources.map((resource) => resource.uri)).join(', ');
			throw new Error(`No MCP server exposes resource "${uri}". Available: ${available || 'none'}`);
		}
		const result = await readServerResource(server.name, uri);
		const contents = result.contents ?? [];
		const text = contents.map((item) => {
			if ('text' in item && typeof item.text === 'string') return item.text;
			if ('blob' in item && typeof item.blob === 'string') return `[Binary content: ${item.mimeType ?? 'unknown'}, base64 length ${item.blob.length}]`;
			return '';
		}).filter(Boolean).join('\n---\n');
		return { ...textResource(url.href, text), notes: [`MCP server: ${server.name}`] };
	}
}

async function currentGitHubRepository(cwd: string): Promise<{ owner: string; repo: string }> {
	let remote: string;
	try {
		const result = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd, windowsHide: true, timeout: 5000 });
		remote = result.stdout.trim();
	} catch {
		throw new Error('Unable to determine the GitHub repository from git remote origin');
	}
	const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
	if (!match) throw new Error(`Origin is not a GitHub repository: ${remote}`);
	return { owner: match[1], repo: match[2] };
}

abstract class GitHubItemProtocolHandler implements ProtocolHandler {
	abstract readonly scheme: 'issue' | 'pr';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;
		const parts = (url.rawPathname || url.pathname).split('/').filter(Boolean).map(decodeURIComponent);
		let owner: string;
		let repo: string;
		let number: string;
		if (/^\d+$/.test(host) && parts.length === 0) {
			({ owner, repo } = await currentGitHubRepository(context.cwd));
			number = host;
		} else if (host && parts.length === 2 && /^\d+$/.test(parts[1])) {
			owner = host;
			repo = parts[0];
			number = parts[1];
		} else {
			throw new Error(`${this.scheme}:// expects ${this.scheme}://<number> or ${this.scheme}://<owner>/<repo>/<number>`);
		}
		const endpoint = this.scheme === 'issue' ? 'issues' : 'pulls';
		const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'spectra-code' };
		if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
		const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${endpoint}/${number}`, {
			headers,
			signal: context.signal,
		});
		if (!response.ok) throw new Error(`GitHub ${this.scheme} read failed: ${response.status} ${response.statusText}`);
		const data = await response.json() as Record<string, unknown>;
		return textResource(url.href, JSON.stringify(data, null, 2), 'application/json');
	}
}

export class IssueProtocolHandler extends GitHubItemProtocolHandler {
	readonly scheme = 'issue' as const;
}

export class PrProtocolHandler extends GitHubItemProtocolHandler {
	readonly scheme = 'pr' as const;
}

export class SshProtocolHandler implements ProtocolHandler {
	readonly scheme = 'ssh';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const host = url.rawHost || url.hostname;
		if (!host || !/^[a-zA-Z0-9._@-]+$/.test(host)) throw new Error('ssh:// requires a valid configured host');
		const remotePath = decodeURIComponent(url.rawPathname || url.pathname || '/');
		if (remotePath.includes('\0') || remotePath.includes('\r') || remotePath.includes('\n')) throw new Error('Invalid SSH path');
		const command = `if [ -d "$1" ]; then printf '__SPECTRA_DIRECTORY__\\n'; find "$1" -mindepth 1 -maxdepth 1 -printf '%y %f\\n'; else cat -- "$1"; fi`;
		try {
			const result = await execFileAsync('ssh', ['--', host, 'sh', '-c', command, 'spectra-read', remotePath], {
				windowsHide: true,
				timeout: 30_000,
				maxBuffer: 16 * 1024 * 1024,
				signal: context.signal,
			});
			const isDirectory = result.stdout.startsWith('__SPECTRA_DIRECTORY__\n');
			const content = isDirectory ? result.stdout.slice('__SPECTRA_DIRECTORY__\n'.length) : result.stdout;
			return { ...textResource(url.href, content), isDirectory };
		} catch (error) {
			throw new Error(`SSH read failed for ${host}:${remotePath}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}
}

export class VaultProtocolHandler implements ProtocolHandler {
	readonly scheme = 'vault';
	readonly immutable = true;

	async resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource> {
		const root = context.vaultDir ?? process.env.SPECTRA_VAULT_DIR;
		if (!root) throw new Error('vault:// is unavailable; configure SPECTRA_VAULT_DIR');
		const relativePath = [url.rawHost || url.hostname, decodeURIComponent((url.rawPathname || url.pathname).replace(/^\//, ''))].filter(Boolean).join('/');
		return readFilesystemResource(url.href, resolveContainedPath(root, relativePath), true);
	}

	async complete(_query: string, context: ResolveContext): Promise<UrlCompletion[]> {
		const root = context.vaultDir ?? process.env.SPECTRA_VAULT_DIR;
		if (!root) return [];
		try {
			const listing = await readFilesystemResource('vault://', path.resolve(root), true);
			return listing.content.split('\n').filter(Boolean).map((entry) => ({ value: entry.replace(/^[dfl] /, '').replace(/\/$/, '') }));
		} catch {
			return [];
		}
	}
}
