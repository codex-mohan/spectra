import type { Disposable, HookInputMap, HookResultMap, HookName } from './types.js';

type AnyHookHandler = (payload: any) => unknown | Promise<unknown>;

interface HookEntry {
	pluginId: string;
	priority: number;
	handler: AnyHookHandler;
}

export interface HookBusOptions {
	/** Per-handler deadline. A hung hook must not block every tool call. */
	handlerTimeoutMs?: number;
}

const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

/** Ordered hook bus. A throwing or hung handler is contained and recorded by the host. */
export class HookBus {
	private readonly entries = new Map<HookName, HookEntry[]>();
	private readonly handlerTimeoutMs: number;
	private errorListener: ((pluginId: string, event: string, error: unknown) => void | Promise<void>) | null = null;

	constructor(options: HookBusOptions = {}) {
		this.handlerTimeoutMs = options.handlerTimeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
	}

	onError(listener: (pluginId: string, event: string, error: unknown) => void | Promise<void>): void {
		this.errorListener = listener;
	}

	private async invoke(entry: HookEntry, event: HookName, payload: unknown): Promise<unknown> {
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		const timer = setTimeout(() => {
			reject(new Error(`Hook ${event} timed out after ${this.handlerTimeoutMs}ms`));
		}, this.handlerTimeoutMs);
		timer.unref?.();
		Promise.resolve(entry.handler(payload)).then(resolve, reject);
		try {
			return await promise;
		} finally {
			clearTimeout(timer);
		}
	}

	on<E extends HookName>(
		pluginId: string,
		event: E,
		handler: (payload: HookInputMap[E]) => void | HookResultMap[E] | Promise<void | HookResultMap[E]>,
		priority = 0,
	): Disposable {
		const entry: HookEntry = { pluginId, priority, handler: handler as AnyHookHandler };
		const list = this.entries.get(event) ?? [];
		list.push(entry);
		list.sort((left, right) => left.priority - right.priority);
		this.entries.set(event, list);
		let active = true;
		return {
			dispose: () => {
				if (!active) return;
				active = false;
				const current = this.entries.get(event);
				if (!current) return;
				const index = current.indexOf(entry);
				if (index >= 0) current.splice(index, 1);
			},
		};
	}

	async run<E extends HookName>(event: E, payload: HookInputMap[E]): Promise<Array<HookResultMap[E]>> {
		const results: Array<HookResultMap[E]> = [];
		for (const entry of [...(this.entries.get(event) ?? [])]) {
			try {
				const result = await this.invoke(entry, event, payload) as HookResultMap[E] | undefined;
				if (result) results.push(result);
			} catch (error) {
				await this.errorListener?.(entry.pluginId, event, error);
			}
		}
		return results;
	}

	async runBlocking<E extends HookName>(event: E, payload: HookInputMap[E]): Promise<Array<HookResultMap[E]>> {
		const results: Array<HookResultMap[E]> = [];
		for (const entry of [...(this.entries.get(event) ?? [])]) {
			try {
				const result = await this.invoke(entry, event, payload) as HookResultMap[E] | undefined;
				if (!result) continue;
				results.push(result);
				if ((result as { block?: boolean }).block === true) break;
			} catch (error) {
				await this.errorListener?.(entry.pluginId, event, error);
			}
		}
		return results;
	}

	disposePlugin(pluginId: string): void {
		for (const [event, list] of this.entries) {
			this.entries.set(event, list.filter((entry) => entry.pluginId !== pluginId));
		}
	}
}
