import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JobRegistry } from '../services/job-registry.js';
import { JobStore } from '../services/job-store.js';
import { autoBackground } from '../services/auto-background.js';

let dir: string;
let store: JobStore;
let registry: JobRegistry;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'spectra-jobs-'));
	store = new JobStore(join(dir, 'jobs.db'));
	registry = new JobRegistry(store);
});

afterEach(() => {
	registry.close();
	rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function job(id = 'job-1') {
	return registry.create({ id, parentSessionId: 'session-1', agent: 'explore', description: 'scan', prompt: 'do it' });
}

describe('job transitions', () => {
	it('runs to completion exactly once and settles listeners fire once', () => {
		const settled = vi.fn();
		registry.onSettled(settled);
		job();
		expect(registry.transition('job-1', ['queued'], 'running')).toBe(true);
		const generation = registry.nextGeneration('job-1');
		expect(registry.complete('job-1', generation, 'done')).toBe(true);
		expect(registry.complete('job-1', generation, 'again')).toBe(false);
		expect(registry.get('job-1')).toMatchObject({ state: 'completed', result: 'done' });
		expect(settled).toHaveBeenCalledTimes(1);
	});

	it('rejects a completion from an older generation', () => {
		job();
		registry.transition('job-1', ['queued'], 'running');
		const first = registry.nextGeneration('job-1');
		const second = registry.nextGeneration('job-1');
		expect(registry.complete('job-1', first, 'stale')).toBe(false);
		expect(registry.complete('job-1', second, 'fresh')).toBe(true);
	});

	it('pauses queued jobs and at the next boundary while running', () => {
		job();
		expect(registry.pause('job-1')).toBe(true);
		expect(registry.get('job-1')?.state).toBe('paused');

		registry.transition('job-1', ['paused'], 'running');
		const generation = registry.nextGeneration('job-1');
		expect(registry.pause('job-1')).toBe(true);
		expect(registry.get('job-1')?.pauseRequested).toBe(true);
		expect(registry.pauseAtBoundary('job-1', generation)).toBe(true);
		expect(registry.get('job-1')?.state).toBe('paused');
	});

	it('is terminal: cancel after completion is refused', () => {
		job();
		registry.transition('job-1', ['queued'], 'running');
		registry.complete('job-1', registry.nextGeneration('job-1'), 'ok');
		expect(registry.cancel('job-1')).toBe(false);
	});
});

describe('delivery', () => {
	it('claims delivery once and never after consumption', () => {
		job();
		registry.transition('job-1', ['queued'], 'running');
		registry.complete('job-1', registry.nextGeneration('job-1'), 'ok');

		expect(registry.claimDelivery('job-1')).toBe(true);
		expect(registry.claimDelivery('job-1')).toBe(false);

		job('job-2');
		registry.transition('job-2', ['queued'], 'running');
		registry.complete('job-2', registry.nextGeneration('job-2'), 'ok');
		registry.consume(['job-2']);
		expect(registry.claimDelivery('job-2')).toBe(false);
	});

	it('recovers orphaned running jobs as paused', () => {
		job();
		registry.transition('job-1', ['queued'], 'running');
		const reopened = new JobRegistry(new JobStore(join(dir, 'jobs.db')));
		expect(reopened.get('job-1')?.state).toBe('paused');
		expect(reopened.get('job-1')?.error).toContain('interrupted');
		reopened.close();
	});
});

describe('auto-background promotion', () => {
	it('resolves the active waiter and removes cancelled waiters', async () => {
		const controller = new AbortController();
		const first = autoBackground.prepare(controller.signal);
		const second = autoBackground.prepare();
		second.cancel();
		expect(autoBackground.requestPromotion()).toBe(true);
		await first.promise;
		expect(autoBackground.requestPromotion()).toBe(false);
		controller.abort();
		expect(autoBackground.requestPromotion()).toBe(false);
	});
});
