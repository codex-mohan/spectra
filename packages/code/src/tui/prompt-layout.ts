export function resolvePromptBarWidths(width?: number | 'auto'): { rootWidth: number | 'auto'; bodyWidth: number | 'auto' } {
	const rootWidth = width ?? 'auto';
	const bodyWidth = typeof rootWidth === 'number' ? Math.max(0, rootWidth - 1) : rootWidth;
	return { rootWidth, bodyWidth };
}
