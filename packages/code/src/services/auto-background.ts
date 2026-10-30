type Resolver = () => void;

/**
 * Coordinates "background the running foreground tool" requests. A user
 * message sets a promotion request; the active tool call races it.
 */
class AutoBackgroundController {
	private waiters = new Set<Resolver>();

	requestPromotion(): boolean {
		if (this.waiters.size === 0) return false;
		const waiters = [...this.waiters];
		this.waiters.clear();
		for (const resolve of waiters) {
			try { resolve(); } catch { /* listener isolation */ }
		}
		return true;
	}

	prepare(signal?: AbortSignal): { promise: Promise<void>; cancel: () => void } {
		const { promise, resolve } = Promise.withResolvers<void>();
		const done = () => {
			this.waiters.delete(done);
			resolve();
		};
		this.waiters.add(done);
		const onAbort = () => this.waiters.delete(done);
		signal?.addEventListener('abort', onAbort, { once: true });
		return {
			promise,
			cancel: () => {
				this.waiters.delete(done);
				signal?.removeEventListener('abort', onAbort);
			},
		};
	}
}

export const autoBackground = new AutoBackgroundController();
