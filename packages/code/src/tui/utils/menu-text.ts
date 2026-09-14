import stringWidth from 'string-width';
import stripAnsi from 'strip-ansi';

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
export function truncateMenuText(value: string, width: number): string {
	const limit = Math.max(0, Math.floor(width));
	const text = stripAnsi(value).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ');
	if (stringWidth(text) <= limit) return text;
	if (limit <= 3) return '.'.repeat(limit);
	let result = '';
	for (const { segment } of segments.segment(text)) {
		if (stringWidth(result + segment) > limit - 3) break;
		result += segment;
	}
	return result + '...';
}

export function menuColumns(width: number, title: string, detail = '') {
	const available = Math.max(0, Math.floor(width));
	// Keep description columns consistent across rows, regardless of title length.
	const detailWidth = detail && available >= 10 ? Math.min(40, Math.floor(available * 0.65)) : 0;
	const titleWidth = available - (detailWidth > 0 ? detailWidth + 1 : 0);
	return { titleWidth, detailWidth, title: truncateMenuText(title, titleWidth), detail: truncateMenuText(detail, detailWidth) };
}
