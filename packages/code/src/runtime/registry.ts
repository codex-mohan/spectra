export type ReloadDomain =
	| 'agents'
	| 'skills'
	| 'plugins'
	| 'commands'
	| 'context'
	| 'mcp'
	| 'tools'
	| 'providers'
	| 'settings';

export const ALL_RELOAD_DOMAINS: readonly ReloadDomain[] = [
	'agents',
	'skills',
	'plugins',
	'commands',
	'context',
	'tools',
	'mcp',
];

export interface RuntimeChange {
	revision: number;
	domains: ReloadDomain[];
}

type RuntimeListener = (change: RuntimeChange) => void;

class RuntimeRegistry {
	private revisionValue = 0;
	private readonly listeners = new Set<RuntimeListener>();

	get revision(): number {
		return this.revisionValue;
	}

	mark(domains: readonly ReloadDomain[]): RuntimeChange {
		this.revisionValue += 1;
		const change: RuntimeChange = { revision: this.revisionValue, domains: [...new Set(domains)] };
		for (const listener of [...this.listeners]) listener(change);
		return change;
	}

	subscribe(listener: RuntimeListener): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}
}

export const runtimeRegistry = new RuntimeRegistry();
