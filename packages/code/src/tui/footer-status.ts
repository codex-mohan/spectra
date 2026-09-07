export type FooterStatus = {
	text: string;
	tone: 'accent' | 'success' | 'warn' | 'error';
	busy: boolean;
	message: string;
};

/** Activity takes precedence over historical notifications in session.status. */
export function resolveFooterStatus(input: {
	isLoading: boolean;
	status: string;
	permissionPending: boolean;
	questionPending: boolean;
	interruptArmed: boolean;
	runningTools: number;
	pendingSteering?: number;
}): FooterStatus {
	if (input.permissionPending) return { text: 'Waiting', message: 'Permission required', tone: 'warn', busy: false };
	if (input.questionPending) return { text: 'Waiting', message: 'Your answer is needed', tone: 'warn', busy: false };
	if (input.isLoading) {
		if (input.interruptArmed) return { text: 'Streaming', message: 'Press Esc again to interrupt', tone: 'warn', busy: true };
		return {
			text: input.runningTools > 0 ? 'Running tools' : 'Streaming', tone: 'accent', busy: true,
			message: input.pendingSteering ? 'Steering queued for next step' : '',
		};
	}
	if (input.status === 'Error') return { text: 'Error', message: 'Response failed; see conversation', tone: 'error', busy: false };
	if (input.status === 'Interrupted') return { text: 'Interrupted', message: '', tone: 'warn', busy: false };
	return { text: 'Ready', message: '', tone: 'success', busy: false };
}

/** Footer labels are owned ASCII strings, never raw tool output or user text. */
export function truncateFooterLabel(text: string, width: number): string {
	const size = Math.max(0, Math.floor(width));
	if (text.length <= size) return text;
	if (size <= 3) return '.'.repeat(size);
	return `${text.slice(0, size - 3)}...`;
}

export function layoutFooter(width: number, metrics: string, isLoading: boolean, activity = 'Ready', message = '') {
	const total = Math.max(0, Math.floor(width));
	const activityWidth = Math.min(activity.length + 2, total);
	let remaining = Math.max(0, total - activityWidth);
	const metricsText = metrics && remaining >= metrics.length + 2 ? metrics : '';
	if (metricsText) remaining -= metricsText.length + 2;
	const statusWidth = message && remaining > 2 ? Math.min(32, remaining - 2) : 0;
	if (statusWidth) remaining -= statusWidth + 2;
	const hints = isLoading ? 'esc interrupt' : 'tab agent  ctrl+t effort  ctrl+p commands';
	const hintsText = remaining >= hints.length + 2 ? hints : '';
	return { total, activityWidth, statusWidth, metricsText, hintsText };
}
