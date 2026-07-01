import { describe, it, expect } from 'vitest';
import { DoomLoopDetector } from '../doom-loop.js';

describe('DoomLoopDetector', () => {
	describe('read-only loop warning', () => {
		it('warns after the configured threshold of consecutive reads', () => {
			const detector = new DoomLoopDetector({ readOnlyRepeatThreshold: 3 });

			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			const warning = detector.recordToolResult('read', true);

			expect(warning.ok).toBe(false);
			expect(warning.action).toBe('warn');
			expect(warning.message).toContain('Read-only loop detected');
		});

		it('resets the counter after emitting a warning', () => {
			const detector = new DoomLoopDetector({ readOnlyRepeatThreshold: 3 });

			detector.recordToolResult('read', true);
			detector.recordToolResult('read', true);
			detector.recordToolResult('read', true); // warns + resets

			// After reset, it should take another full threshold before warning again.
			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			const secondWarning = detector.recordToolResult('read', true);
			expect(secondWarning.ok).toBe(false);
			expect(secondWarning.action).toBe('warn');
		});

		it('resets the counter on a successful write', () => {
			const detector = new DoomLoopDetector({ readOnlyRepeatThreshold: 3 });

			detector.recordToolResult('read', true);
			detector.recordToolResult('read', true);
			detector.recordToolResult('write', true); // resets

			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			expect(detector.recordToolResult('read', true)).toEqual({ ok: true });
			const warning = detector.recordToolResult('read', true);
			expect(warning.ok).toBe(false);
			expect(warning.action).toBe('warn');
		});
	});

	describe('repeated identical call stop', () => {
		it('stops after the configured threshold of identical calls', () => {
			const detector = new DoomLoopDetector({ writeRepeatThreshold: 2 });
			const args = { path: 'foo.ts' };

			expect(detector.recordToolCall('write', args)).toEqual({ ok: true });
			const stop = detector.recordToolCall('write', args);

			expect(stop.ok).toBe(false);
			expect(stop.action).toBe('stop');
			expect(stop.message).toContain('Doom loop detected');
		});
	});

	describe('patch spiral warning', () => {
		it('warns after the configured threshold of consecutive failures on the same file', () => {
			const detector = new DoomLoopDetector({ patchSpiralThreshold: 2 });

			expect(detector.recordPatchFailure('foo.ts')).toEqual({ ok: true });
			const warning = detector.recordPatchFailure('foo.ts');

			expect(warning.ok).toBe(false);
			expect(warning.action).toBe('warn');
			expect(warning.message).toContain('Patch spiral');
		});

		it('resets the failure counter after emitting a warning', () => {
			const detector = new DoomLoopDetector({ patchSpiralThreshold: 2 });

			detector.recordPatchFailure('foo.ts');
			const firstWarning = detector.recordPatchFailure('foo.ts'); // warns + resets
			expect(firstWarning.ok).toBe(false);
			expect(firstWarning.action).toBe('warn');

			expect(detector.recordPatchFailure('foo.ts')).toEqual({ ok: true });
			const secondWarning = detector.recordPatchFailure('foo.ts');
			expect(secondWarning.ok).toBe(false);
			expect(secondWarning.action).toBe('warn');
		});
		it('resets the failure counter on patch success', () => {
			const detector = new DoomLoopDetector({ patchSpiralThreshold: 2 });

			detector.recordPatchFailure('foo.ts');
			detector.recordPatchSuccess('foo.ts'); // resets

			expect(detector.recordPatchFailure('foo.ts')).toEqual({ ok: true });
			const warning = detector.recordPatchFailure('foo.ts');
			expect(warning.ok).toBe(false);
			expect(warning.action).toBe('warn');
		});
	});
});
