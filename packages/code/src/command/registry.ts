// ---------------------------------------------------------------------------
// Immutable deterministic command registry snapshot.
// ---------------------------------------------------------------------------

import type {
	CommandDefinition,
	ResolvedCommand,
} from './types.js';

// ---------------------------------------------------------------------------
// Registry snapshot
// ---------------------------------------------------------------------------

export interface RegistrySnapshot {
	/** All resolved invocation names (including collision suffixes like `foo:2`). */
	readonly slashNames: ReadonlySet<string>;

	/** All resolved commands in registration order. */
	readonly entries: readonly ResolvedCommand[];

	/** Resolve an exact invocation name. Returns undefined if not found. */
	readonly resolve: (invocation: string) => ResolvedCommand | undefined;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Normalise a name: strip leading `/`, lowercase, trim whitespace. */
function normalizeName(raw: string): string {
	return raw.replace(/^\//, '').trim().toLowerCase();
}

/**
 * Given a base name and a running collision counter, produce the unique
 * invocation key and increment the counter.
 *
 *  - count 0 → key = base, result count 1
 *  - count 1 → key = base:2, result count 2
 *  - count 2 → key = base:3, result count 3
 *  - …
 */
function uniqueKey(base: string, counter: Map<string, number>): string {
	const count = counter.get(base) ?? 0;
	counter.set(base, count + 1);
	return count === 0 ? base : `${base}:${count + 1}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build an immutable, deterministic snapshot from an ordered list of
 * definitions. Input order is preserved for same-priority builtins.
 *
 * Collision handling:
 *  - The first definition to claim a name gets the bare invocation.
 *  - Subsequent definitions with the same canonical name receive stable
 *    `:2`, `:3`, … suffixed invocations.
 *  - Aliases follow the same collision logic.
 *  - Every generated invocation is reachable via `resolve()` and listed
 *    in `slashNames`.
 */
export function createRegistry(
	definitions: readonly CommandDefinition[],
): RegistrySnapshot {
	const counter = new Map<string, number>(); // canonical name → next collision count
	const invocationMap = new Map<string, ResolvedCommand>();
	const entries: ResolvedCommand[] = [];

	for (const def of definitions) {
		const canonical = normalizeName(def.name);

		// --- register canonical name ---
		const nameKey = uniqueKey(canonical, counter);
		const nameCollisionIdx =
			nameKey === canonical ? 0 : parseInt(nameKey.slice(canonical.length + 1), 10) - 1;

		const nameEntry: ResolvedCommand = {
			definition: def,
			invocation: nameKey,
			collisionIndex: nameCollisionIdx,
			matchedBy: 'name',
		};
		invocationMap.set(nameKey, nameEntry);
		entries.push(nameEntry);

		// Aliases resolve to the same definition but do not create duplicate menu rows.
		for (const alias of def.aliases) {
			const aliasNorm = normalizeName(alias);
			const aliasKey = uniqueKey(aliasNorm, counter);
			const aliasCollisionIdx =
				aliasKey === aliasNorm ? 0 : parseInt(aliasKey.slice(aliasNorm.length + 1), 10) - 1;

			invocationMap.set(aliasKey, {
				definition: def,
				invocation: aliasKey,
				collisionIndex: aliasCollisionIdx,
				matchedBy: 'alias',
			});
		}
	}

	const slashNames = new Set(invocationMap.keys());

	function resolve(invocation: string): ResolvedCommand | undefined {
		return invocationMap.get(normalizeName(invocation));
	}

	return Object.freeze({ slashNames, entries: Object.freeze(entries), resolve });
}
