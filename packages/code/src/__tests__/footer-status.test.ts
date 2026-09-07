import { describe, expect, it } from 'vitest';
import { layoutFooter, resolveFooterStatus, truncateFooterLabel } from '../tui/footer-status.js';

const idle = { isLoading: false, status: 'Ready', permissionPending: false, questionPending: false, interruptArmed: false, runningTools: 0 };

describe('footer activity', () => {
	it('keeps Ready free of stale detail and clears steering detail once consumed', () => {
		expect(resolveFooterStatus(idle)).toMatchObject({ text: 'Ready', message: '' });
		expect(resolveFooterStatus({ ...idle, isLoading: true, pendingSteering: 1 })).toMatchObject({ text: 'Streaming', message: 'Steering queued for next step' });
		expect(resolveFooterStatus({ ...idle, isLoading: true, pendingSteering: 0 }).message).toBe('');
	});
	it.each(['Steering sent to model', 'shell failed: enormous error', 'Subagent @explore completed'])(
		'ignores stale notification: %s', (status) => {
			expect(resolveFooterStatus({ ...idle, status }).text).toBe('Ready');
			expect(resolveFooterStatus({ ...idle, status, isLoading: true }).text).toBe('Streaming');
		},
	);
	it('prioritizes permission and question waits over tools', () => {
		expect(resolveFooterStatus({ ...idle, isLoading: true, runningTools: 2, permissionPending: true })).toMatchObject({ text: 'Waiting', message: 'Permission required', tone: 'warn', busy: false });
		expect(resolveFooterStatus({ ...idle, questionPending: true }).message).toBe('Your answer is needed');
	});
	it('uses distinct styling for failures, interruptions, readiness and activity', () => {
		expect(resolveFooterStatus({ ...idle, status: 'Error' }).tone).toBe('error');
		expect(resolveFooterStatus({ ...idle, status: 'Interrupted' }).tone).toBe('warn');
		expect(resolveFooterStatus(idle).tone).toBe('success');
		expect(resolveFooterStatus({ ...idle, isLoading: true, runningTools: 1 })).toMatchObject({ text: 'Running tools', tone: 'accent', busy: true });
		expect(resolveFooterStatus({ ...idle, isLoading: true, interruptArmed: true }).message).toBe('Press Esc again to interrupt');
	});
});

describe('footer width budget', () => {
	it('truncates within the dedicated width with three dots', () => {
		expect(truncateFooterLabel('overflowing text here', 18)).toBe('overflowing tex...');
		expect(truncateFooterLabel('Ready', 5)).toBe('Ready');
		expect(truncateFooterLabel('Ready', 2)).toBe('..');
		expect(truncateFooterLabel('Ready', 0)).toBe('');
	});
	it('never exceeds the row budget across narrow terminals and resizes', () => {
		for (let width = 0; width <= 240; width++) {
			for (const loading of [true, false]) {
				const layout = layoutFooter(width, '12.3K (5%) $0.0112', loading, 'Running tools', 'Press Esc again to interrupt');
				const used = layout.activityWidth + (layout.statusWidth ? layout.statusWidth + 2 : 0) + (layout.metricsText ? layout.metricsText.length + 2 : 0) + (layout.hintsText ? layout.hintsText.length + 2 : 0);
				expect(used).toBeLessThanOrEqual(width);
				expect(layout.statusWidth).toBeLessThanOrEqual(32);
				expect(truncateFooterLabel('Press Esc again to interrupt', Math.max(0, layout.statusWidth - 2)).length).toBeLessThanOrEqual(Math.max(0, layout.statusWidth - 2));
			}
		}
	});
	it('keeps context before the bounded status and hides shortcuts on narrow rows', () => {
		expect(layoutFooter(32, '12.3K (5%) $0.0112', false, 'Ready', 'Permission required')).toEqual({ total: 32, activityWidth: 7, statusWidth: 3, metricsText: '12.3K (5%) $0.0112', hintsText: '' });
	});
});
