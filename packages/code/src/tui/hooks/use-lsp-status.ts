import { useEffect, useState } from 'react';
import { peekLspStatus } from '../../lsp/manager.js';

const REFRESH_MS = 5000;

/** Number of running LSP servers, polled without creating a manager. */
export function useLspStatus(): number {
	const [count, setCount] = useState(() => peekLspStatus().filter((server) => server.running).length);
	useEffect(() => {
		const id = setInterval(() => {
			const next = peekLspStatus().filter((server) => server.running).length;
			setCount((previous) => (previous === next ? previous : next));
		}, REFRESH_MS);
		return () => clearInterval(id);
	}, []);
	return count;
}
