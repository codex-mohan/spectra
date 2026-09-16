import type { Skill } from '@mohanscodex/spectra-agent';
import type { SessionStore } from '../services/session-store.js';

export type ResourceContentType = 'text/markdown' | 'application/json' | 'text/plain';

export interface InternalResource {
	url: string;
	content: string;
	contentType: ResourceContentType;
	size?: number;
	sourcePath?: string;
	notes?: string[];
	immutable?: boolean;
	isDirectory?: boolean;
}

export interface InternalUrl extends URL {
	rawHost: string;
	rawPathname: string;
}

export interface NamedResource {
	name: string;
	content: string;
	description?: string;
	contentType?: ResourceContentType;
}

export interface ResolveContext {
	cwd: string;
	signal?: AbortSignal;
	sessionId?: string;
	sessionStore?: SessionStore;
	skills?: ReadonlyMap<string, Skill>;
	rules?: ReadonlyMap<string, NamedResource>;
	artifactDir?: string;
	localDir?: string;
	vaultDir?: string;
}

export interface WriteContext extends ResolveContext {}

export interface UrlCompletion {
	value: string;
	label?: string;
	description?: string;
}

export interface ProtocolHandler {
	readonly scheme: string;
	readonly immutable: boolean;
	resolve(url: InternalUrl, context: ResolveContext): Promise<InternalResource>;
	write?(url: InternalUrl, content: string, context: WriteContext): Promise<void>;
	complete?(query: string, context: ResolveContext): Promise<UrlCompletion[]>;
}
