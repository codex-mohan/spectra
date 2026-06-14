import React, { useState, useEffect } from 'react';
import { c, SPINNER } from '../theme.js';
import type { SessionManager, SessionState } from '../../services/session-manager.js';

interface SessionStatusBarProps {
	sessionManager: SessionManager;
	activeSessionId: string | null;
	spinnerFrame: number;
	onSessionClick?: (sessionId: string) => void;
}

export function SessionStatusBar({ sessionManager, activeSessionId, spinnerFrame, onSessionClick }: SessionStatusBarProps) {
	const [sessions, setSessions] = useState<SessionState[]>([]);

	useEffect(() => {
		const unsubscribe = sessionManager.onEvent(() => {
			setSessions(sessionManager.getAllSessions());
		});
		setSessions(sessionManager.getAllSessions());
		return unsubscribe;
	}, [sessionManager]);

	const busySessions = sessions.filter((s) => s.status === 'busy');
	const idleSessions = sessions.filter((s) => s.status !== 'busy' && s.id !== activeSessionId);

	if (sessions.length <= 1) return null;

	return (
		<box flexDirection="row" gap={2} alignItems="center" paddingLeft={3} paddingRight={1}>
			<text fg={c.dim}>Sessions:</text>
			{busySessions.map((s) => (
				<box key={s.id} flexDirection="row" gap={1} alignItems="center">
					<text fg={c.warn}>{SPINNER[spinnerFrame]}</text>
					<text fg={c.accent}>{s.id.slice(0, 8)}</text>
				</box>
			))}
			{idleSessions.slice(0, 3).map((s) => (
				<box key={s.id} flexDirection="row" gap={1} alignItems="center">
					<text fg={c.dim}>{"\u25CB"}</text>
					<text fg={c.dim}>{s.id.slice(0, 8)}</text>
				</box>
			))}
			{idleSessions.length > 3 && (
				<text fg={c.dim}>+{idleSessions.length - 3}</text>
			)}
		</box>
	);
}
