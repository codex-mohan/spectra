import type { InternalUrl } from './types.js';

const INTERNAL_URL = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;

export function parseInternalUrl(input: string): InternalUrl {
	const match = INTERNAL_URL.exec(input);
	if (!match) throw new Error(`Invalid internal resource URI: ${input}`);

	let parsed: URL;
	try {
		parsed = new URL(input);
	} catch (error) {
		throw new Error(`Invalid internal resource URI: ${input}: ${error instanceof Error ? error.message : String(error)}`);
	}

	Object.defineProperties(parsed, {
		rawHost: { value: decodeURIComponent(match[2] ?? ''), enumerable: true },
		rawPathname: { value: match[3] ?? '', enumerable: true },
	});
	return parsed as InternalUrl;
}

export function internalScheme(input: string): string | undefined {
	return /^([a-z][a-z0-9+.-]*):\/\//i.exec(input)?.[1]?.toLowerCase();
}
