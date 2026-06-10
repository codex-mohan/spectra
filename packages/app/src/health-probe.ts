import type { HealthStatus, EngineLifecycle } from './types.js';

export class HealthProbe {
	private _startTime: number;
	private checks: Map<string, () => Promise<{ status: 'ok' | 'error'; message?: string }>>;

	constructor() {
		this._startTime = Date.now();
		this.checks = new Map();
	}

	registerCheck(name: string, check: () => Promise<{ status: 'ok' | 'error'; message?: string }>): void {
		this.checks.set(name, check);
	}

	async health(lifecycle: EngineLifecycle, activeSessions: number): Promise<HealthStatus> {
		const results: Record<string, { status: 'ok' | 'error'; message?: string }> = {};
		let degraded = false;

		for (const [name, check] of this.checks) {
			try {
				results[name] = await check();
				if (results[name].status === 'error') degraded = true;
			} catch (err) {
				results[name] = {
					status: 'error',
					message: err instanceof Error ? err.message : String(err),
				};
				degraded = true;
			}
		}

		return {
			status: lifecycle !== 'running' ? 'unhealthy' : degraded ? 'degraded' : 'healthy',
			uptime: Date.now() - this._startTime,
			activeSessions,
			engineState: lifecycle,
			checks: results,
		};
	}
}
