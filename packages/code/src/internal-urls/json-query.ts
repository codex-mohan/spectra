function decodePointerToken(token: string): string {
	return decodeURIComponent(token).replace(/~1/g, '/').replace(/~0/g, '~');
}

export function queryJson(value: unknown, query: string): unknown {
	const normalized = query.trim().replace(/^\$?\.?/, '');
	if (!normalized) return value;
	const segments = normalized.startsWith('/')
		? normalized.slice(1).split('/').map(decodePointerToken)
		: normalized.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).map(decodePointerToken);

	let current = value;
	for (const segment of segments) {
		if (Array.isArray(current)) {
			const index = Number(segment);
			if (!Number.isInteger(index) || index < 0 || index >= current.length) throw new Error(`JSON query index not found: ${segment}`);
			current = current[index];
			continue;
		}
		if (current === null || typeof current !== 'object' || !(segment in current)) {
			throw new Error(`JSON query field not found: ${segment}`);
		}
		current = (current as Record<string, unknown>)[segment];
	}
	return current;
}
