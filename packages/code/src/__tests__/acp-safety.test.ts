import { describe, expect, it } from 'vitest';
import { safetyUpdate } from '../integrations/acp/safety.js';

describe('ACP safety updates', () => {
	it('forwards kind, severity, message, and details', () => {
		const update = safetyUpdate('session-1', {
			type: 'safety',
			kind: 'repetition',
			severity: 'interrupt',
			message: 'Repetition loop detected',
			details: { repeats: 4 },
		});
		expect(update).toEqual({
			sessionId: 'session-1',
			status: 'running',
			warning: {
				kind: 'repetition',
				severity: 'interrupt',
				message: 'Repetition loop detected',
				details: { repeats: 4 },
			},
		});
	});
});
