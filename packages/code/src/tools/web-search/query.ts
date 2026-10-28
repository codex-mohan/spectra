import type { SearchResult } from './types.js';

export interface ParsedQuery {
	text: string;
	sites: string[];
	excludedSites: string[];
	filetypes: string[];
	excludedTerms: string[];
}

const TOKEN_RE = /"([^"]*)"|(\S+)/g;

export function parseQuery(raw: string): ParsedQuery {
	const parsed: ParsedQuery = { text: '', sites: [], excludedSites: [], filetypes: [], excludedTerms: [] };
	const kept: string[] = [];
	for (const match of raw.matchAll(TOKEN_RE)) {
		const quoted = match[1];
		const token = quoted ?? match[2] ?? '';
		if (quoted !== undefined) {
			kept.push(`"${quoted}"`);
			continue;
		}
		if (token.startsWith('-site:')) {
			parsed.excludedSites.push(token.slice(6));
			continue;
		}
		if (token.startsWith('site:')) {
			parsed.sites.push(token.slice(5));
			continue;
		}
		if (token.startsWith('filetype:')) {
			parsed.filetypes.push(token.slice(9).replace(/^\./, '').toLowerCase());
			continue;
		}
		if (token.startsWith('-') && token.length > 1 && !/^-\d/.test(token)) {
			parsed.excludedTerms.push(token.slice(1));
			continue;
		}
		kept.push(token);
	}
	parsed.text = kept.join(' ').trim();
	return parsed;
}

function hostOf(url: string): string {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return '';
	}
}

function matchesSite(host: string, pattern: string): boolean {
	const clean = pattern.toLowerCase().replace(/^\*\./, '');
	return host === clean || host.endsWith(`.${clean}`);
}

function matchesFiletype(result: SearchResult, filetype: string): boolean {
	try {
		const path = new URL(result.url).pathname.toLowerCase();
		return path.endsWith(`.${filetype}`);
	} catch {
		return false;
	}
}

/** Apply query constraints leniently; a dimension that would remove every result is relaxed with a note. */
export function applyConstraints(
	results: SearchResult[],
	parsed: ParsedQuery,
): { results: SearchResult[]; notes: string[] } {
	const seen = new Set<string>();
	let current = results.filter((result) => {
		if (seen.has(result.url)) return false;
		seen.add(result.url);
		return true;
	});
	const notes: string[] = [];

	const dimensions: Array<{ label: string; keep: (result: SearchResult) => boolean }> = [];
	if (parsed.sites.length > 0) {
		dimensions.push({
			label: `site:${parsed.sites.join(',')}`,
			keep: (result) => parsed.sites.some((site) => matchesSite(hostOf(result.url), site)),
		});
	}
	if (parsed.excludedSites.length > 0) {
		dimensions.push({
			label: `-site:${parsed.excludedSites.join(',')}`,
			keep: (result) => !parsed.excludedSites.some((site) => matchesSite(hostOf(result.url), site)),
		});
	}
	if (parsed.filetypes.length > 0) {
		dimensions.push({
			label: `filetype:${parsed.filetypes.join(',')}`,
			keep: (result) => parsed.filetypes.some((filetype) => matchesFiletype(result, filetype)),
		});
	}
	if (parsed.excludedTerms.length > 0) {
		dimensions.push({
			label: parsed.excludedTerms.map((term) => `-${term}`).join(' '),
			keep: (result) => {
				const haystack = `${result.title} ${result.snippet}`.toLowerCase();
				return !parsed.excludedTerms.some((term) => haystack.includes(term.toLowerCase()));
			},
		});
	}

	for (const dimension of dimensions) {
		const filtered = current.filter(dimension.keep);
		if (filtered.length === 0 && current.length > 0) {
			notes.push(`no results matched ${dimension.label}; filter relaxed`);
			continue;
		}
		current = filtered;
	}

	return { results: current, notes };
}
