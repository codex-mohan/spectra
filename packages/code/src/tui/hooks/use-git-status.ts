import { useCallback, useEffect, useRef, useState } from 'react';
import { readGitStatus, readGitStatusAsync, reconcileGitStatus, type GitStatus } from '../../services/git-status.js';

const REFRESH_MS = 5000;

export function useGitStatus(cwd: string, isLoading: boolean) {
	const initial = useRef<GitStatus | null>(readGitStatus(cwd));
	const [status, setStatus] = useState<GitStatus | null>(initial.current);
	const statusRef = useRef<GitStatus | null>(initial.current);
	const failures = useRef(0);
	const wasLoading = useRef(isLoading);

	const inFlight = useRef(false);

	const refresh = useCallback(async () => {
		if (inFlight.current) return;
		inFlight.current = true;
		try {
			const next = await readGitStatusAsync(cwd);
			const reconciled = reconcileGitStatus(statusRef.current, next, failures.current);
			failures.current = reconciled.failures;
			if (reconciled.status !== statusRef.current) {
				statusRef.current = reconciled.status;
				setStatus(reconciled.status);
			}
		} finally {
			inFlight.current = false;
		}
	}, [cwd]);

	useEffect(() => {
		const id = setInterval(() => { void refresh(); }, REFRESH_MS);
		return () => clearInterval(id);
	}, [refresh]);

	useEffect(() => {
		if (wasLoading.current && !isLoading) void refresh();
		wasLoading.current = isLoading;
	}, [isLoading, refresh]);

	return { status, refresh };
}
