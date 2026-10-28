import type { SearchDetails } from './types.js';

export function formatSearchResults(details: SearchDetails): string {
	const lines: string[] = [];
	for (const note of details.notes ?? []) lines.push(`Note: ${note}`);

	if (details.results.length === 0) {
		lines.push(`No results for "${details.query}".`);
		return lines.join('\n');
	}

	details.results.forEach((result, index) => {
		const age = result.publishedAt ? ` (${result.publishedAt})` : '';
		lines.push(`${index + 1}. ${result.title}${age}`);
		lines.push(`   ${result.url}`);
		if (result.snippet) lines.push(`   ${result.snippet}`);
	});
	return lines.join('\n');
}
