export function fuzzyMatch(pattern: string, text: string): FuzzyResult | null {
	if (!pattern) return { score: 0, indices: [] };

	const lowerPattern = pattern.toLowerCase();
	const lowerText = text.toLowerCase();

	let patternIdx = 0;
	const indices: number[] = [];
	let score = 0;
	let lastMatchIdx = -2;

	for (let i = 0; i < lowerText.length && patternIdx < lowerPattern.length; i++) {
		if (lowerText[i] === lowerPattern[patternIdx]) {
			indices.push(i);
			if (i === lastMatchIdx + 1) {
				score += 3;
			} else {
				score += 1;
			}
			if (
				i === 0 ||
				lowerText[i - 1] === ' ' ||
				lowerText[i - 1] === '-' ||
				lowerText[i - 1] === '_' ||
				lowerText[i - 1] === '/'
			) {
				score += 4;
			}
			if (text[i] === pattern[patternIdx]) {
				score += 2;
			}
			lastMatchIdx = i;
			patternIdx++;
		}
	}

	if (patternIdx < lowerPattern.length) return null;
	return { score, indices };
}

export interface FuzzyResult {
	score: number;
	indices: number[];
}

export function fuzzySort<T extends FuzzyItem>(pattern: string, items: T[]): FuzzyScoredItem<T>[] {
	if (!pattern) return items.map((item) => ({ item, score: 0, indices: [] }));

	const results: FuzzyScoredItem<T>[] = [];
	for (const item of items) {
		const result = fuzzyMatch(pattern, item.label);
		if (result) {
			results.push({ item, score: result.score, indices: result.indices });
		}
	}
	results.sort((a, b) => b.score - a.score);
	return results;
}

export interface FuzzyItem {
	label: string;
	[key: string]: unknown;
}

export interface FuzzyScoredItem<T> {
	item: T;
	score: number;
	indices: number[];
}
