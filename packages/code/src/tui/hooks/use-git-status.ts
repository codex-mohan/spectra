import { useCallback, useEffect, useRef, useState } from 'react';
import { readGitStatus, sameGitStatus, type GitStatus } from '../../services/git-status.js';

const REFRESH_MS = 5000;

export function useGitStatus(cwd: string, isLoading: boolean) {
	const [status, setStatus] = useState<GitStatus | null>(() => readGitStatus(cwd));
	const wasLoading = useRef(isLoading);

	const refresh = useCallback(() => {
		const next = readGitStatus(cwd);
		setStatus((previous) => (sameGitStatus(previous, next) ? previous : next));
	}, [cwd]);

	useEffect(() => {
		const id = setInterval(refresh, REFRESH_MS);
		return () => clearInterval(id);
	}, [refresh]);

	useEffect(() => {
		if (wasLoading.current && !isLoading) refresh();
		wasLoading.current = isLoading;
	}, [isLoading, refresh]);

	return { status, refresh };
}
