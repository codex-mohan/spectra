export interface SelectionWindow {
	start: number;
	end: number;
}

export function getCenteredWindow(totalRows: number, selectedRow: number, maxRows: number): SelectionWindow {
	if (totalRows <= 0 || maxRows <= 0) return { start: 0, end: 0 };
	const visibleRows = Math.min(totalRows, maxRows);
	const clampedSelected = Math.min(Math.max(0, selectedRow), totalRows - 1);
	const centerOffset = Math.floor(visibleRows / 2);
	const maxStart = totalRows - visibleRows;
	const start = Math.min(Math.max(0, clampedSelected - centerOffset), maxStart);
	return { start, end: start + visibleRows };
}
