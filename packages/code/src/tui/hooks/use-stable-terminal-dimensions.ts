import { useEffect, useState } from 'react';
import { useRenderer } from '@opentui/react';

export interface TerminalDimensions {
	width: number;
	height: number;
}

/**
 * Terminal dimensions that only change when the values actually change.
 *
 * OpenTUI's built-in hook stores a fresh `{ width, height }` object for every
 * resize event. The renderer can emit resize while layout is settling, so a
 * same-value event would still schedule a render, which can schedule another
 * resize and trip React's maximum-update-depth guard. Returning the previous
 * state on equal dimensions makes that path a no-op.
 */
export function useStableTerminalDimensions(): TerminalDimensions {
	const renderer = useRenderer();
	const [dimensions, setDimensions] = useState<TerminalDimensions>(() => ({
		width: renderer.width,
		height: renderer.height,
	}));

	useEffect(() => {
		const handleResize = (width: number, height: number) => {
			setDimensions((previous) => (
				previous.width === width && previous.height === height
					? previous
					: { width, height }
			));
		};
		renderer.on('resize', handleResize);
		return () => {
			renderer.off('resize', handleResize);
		};
	}, [renderer]);

	return dimensions;
}
