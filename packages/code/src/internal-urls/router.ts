import { parseInternalUrl } from './parse.js';
import type { InternalResource, ProtocolHandler, ResolveContext, UrlCompletion } from './types.js';

export class InternalUrlRouter {
	readonly #handlers = new Map<string, ProtocolHandler>();

	constructor(handlers: readonly ProtocolHandler[] = []) {
		for (const handler of handlers) this.register(handler);
	}

	register(handler: ProtocolHandler): void {
		const scheme = handler.scheme.toLowerCase();
		if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) throw new Error(`Invalid protocol scheme: ${handler.scheme}`);
		this.#handlers.set(scheme, handler);
	}

	unregister(scheme: string): boolean {
		return this.#handlers.delete(scheme.toLowerCase());
	}

	getHandler(scheme: string): ProtocolHandler | undefined {
		return this.#handlers.get(scheme.toLowerCase());
	}

	canHandle(input: string): boolean {
		const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)?.[1];
		return scheme ? this.#handlers.has(scheme.toLowerCase()) : false;
	}

	listSchemes(): string[] {
		return [...this.#handlers.keys()].sort();
	}

	async complete(scheme: string, query: string, context: ResolveContext): Promise<UrlCompletion[] | null> {
		const handler = this.#handlers.get(scheme.toLowerCase());
		return handler?.complete ? handler.complete(query, context) : null;
	}

	async resolve(input: string, context: ResolveContext): Promise<InternalResource> {
		const url = parseInternalUrl(input);
		const scheme = url.protocol.slice(0, -1).toLowerCase();
		const handler = this.#handlers.get(scheme);
		if (!handler) {
			throw new Error(`Unknown protocol: ${scheme}://\nSupported: ${this.listSchemes().map((item) => `${item}://`).join(', ') || 'none'}`);
		}
		const resource = await handler.resolve(url, context);
		return { ...resource, immutable: resource.immutable ?? handler.immutable };
	}

	async write(input: string, content: string, context: ResolveContext): Promise<void> {
		const url = parseInternalUrl(input);
		const scheme = url.protocol.slice(0, -1).toLowerCase();
		const handler = this.#handlers.get(scheme);
		if (!handler) throw new Error(`Unknown protocol: ${scheme}://`);
		if (!handler.write || handler.immutable) throw new Error(`${scheme}:// resources are read-only`);
		await handler.write(url, content, context);
	}
}
