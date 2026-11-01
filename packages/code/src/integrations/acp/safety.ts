import type { AgentEvent } from '@mohanscodex/spectra-agent';

type SafetyEvent = Extract<AgentEvent, { type: 'safety' }>;

/** Session update payload for a safety event. Shared with tests. */
export function safetyUpdate(sessionId: string, event: SafetyEvent): Record<string, unknown> {
	return {
		sessionId,
		status: 'running',
		warning: {
			kind: event.kind,
			severity: event.severity,
			message: event.message,
			details: event.details,
		},
	};
}
