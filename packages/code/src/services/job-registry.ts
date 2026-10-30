import { JobStore } from './job-store.js';

export type JobState = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type JobTerminalState = Extract<JobState, 'completed' | 'failed' | 'cancelled'>;

export interface JobRecord {
	id: string;
	parentSessionId: string;
	childSessionId?: string;
	agent: string;
	description: string;
	prompt: string;
	state: JobState;
	pauseRequested: boolean;
	generation: number;
	queuedAt: number;
	startedAt?: number;
	finishedAt?: number;
	settledAt?: number;
	deliveredAt?: number;
	consumedAt?: number;
	result?: string;
	error?: string;
	retryAttempts: number;
	lastCheckpointAt?: number;
}

export interface CreateJobInput {
	id: string;
	parentSessionId: string;
	childSessionId?: string;
	agent: string;
	description: string;
	prompt: string;
	state?: JobState;
}

export type JobListener = (job: JobRecord) => void;

const TERMINAL: JobState[] = ['completed', 'failed', 'cancelled'];

export class JobRegistry {
	private jobs = new Map<string, JobRecord>();
	private updates: JobListener[] = [];
	private settledListeners: JobListener[] = [];

	constructor(private readonly store = new JobStore()) {
		for (const job of this.store.load()) this.jobs.set(job.id, job);
		this.recoverOrphans();
	}

	/** Jobs left running by a previous process become paused, never running. */
	private recoverOrphans(): void {
		for (const job of this.jobs.values()) {
			if (job.state === 'running' || job.state === 'queued') {
				job.state = 'paused';
				job.pauseRequested = false;
				job.error = 'interrupted by exit';
				this.persist(job);
			}
		}
	}

	create(input: CreateJobInput): JobRecord {
		const job: JobRecord = {
			id: input.id,
			parentSessionId: input.parentSessionId,
			...(input.childSessionId ? { childSessionId: input.childSessionId } : {}),
			agent: input.agent,
			description: input.description,
			prompt: input.prompt,
			state: input.state ?? 'queued',
			pauseRequested: false,
			generation: 0,
			queuedAt: Date.now(),
			retryAttempts: 0,
		};
		this.jobs.set(job.id, job);
		this.persist(job);
		this.emit(job);
		return job;
	}

	get(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	all(): JobRecord[] {
		return [...this.jobs.values()];
	}

	forParent(parentSessionId: string): JobRecord[] {
		return this.all().filter((job) => job.parentSessionId === parentSessionId);
	}

	/** Single-shot transition. Returns false when the current state is not allowed. */
	transition(id: string, allowedFrom: JobState[], next: JobState, patch: Partial<JobRecord> = {}): boolean {
		const job = this.jobs.get(id);
		if (!job || !allowedFrom.includes(job.state)) return false;
		Object.assign(job, patch, { state: next });
		if (TERMINAL.includes(next)) {
			job.finishedAt ??= Date.now();
			job.settledAt ??= Date.now();
		}
		if (next === 'running') {
			job.startedAt ??= Date.now();
			job.pauseRequested = false;
		}
		this.persist(job);
		this.emit(job);
		if (TERMINAL.includes(next)) this.emitSettled(job);
		return true;
	}

	update(id: string, patch: Partial<JobRecord>): void {
		const job = this.jobs.get(id);
		if (!job) return;
		Object.assign(job, patch);
		this.persist(job);
		this.emit(job);
	}

	nextGeneration(id: string): number {
		const job = this.jobs.get(id);
		if (!job) return 0;
		job.generation += 1;
		this.persist(job);
		return job.generation;
	}

	complete(id: string, generation: number, result: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.generation !== generation) return false;
		return this.transition(id, ['running', 'paused'], 'completed', { result, error: undefined });
	}

	fail(id: string, generation: number, error: string): boolean {
		const job = this.jobs.get(id);
		if (!job || job.generation !== generation) return false;
		return this.transition(id, ['running', 'paused'], 'failed', { error });
	}

	pause(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job) return false;
		if (job.state === 'queued') return this.transition(id, ['queued'], 'paused');
		if (job.state !== 'running') return false;
		job.pauseRequested = true;
		this.persist(job);
		this.emit(job);
		return true;
	}

	pauseAtBoundary(id: string, generation: number): boolean {
		const job = this.jobs.get(id);
		if (!job || job.generation !== generation || !job.pauseRequested) return false;
		return this.transition(id, ['running'], 'paused', { pauseRequested: false });
	}

	cancel(id: string): boolean {
		return this.transition(id, ['queued', 'running', 'paused'], 'cancelled');
	}

	/** Claim delivery exactly once. */
	claimDelivery(id: string): boolean {
		const job = this.jobs.get(id);
		if (!job || !job.settledAt || job.deliveredAt || job.consumedAt) return false;
		job.deliveredAt = Date.now();
		this.persist(job);
		return true;
	}

	consume(ids: string[]): void {
		for (const id of ids) {
			const job = this.jobs.get(id);
			if (!job || !job.settledAt || job.consumedAt) continue;
			job.consumedAt = Date.now();
			this.persist(job);
		}
	}

	undelivered(): JobRecord[] {
		return this.all().filter((job) => job.settledAt && !job.deliveredAt && !job.consumedAt);
	}

	onUpdate(listener: JobListener): () => void {
		this.updates.push(listener);
		return () => {
			this.updates = this.updates.filter((entry) => entry !== listener);
		};
	}

	onSettled(listener: JobListener): () => void {
		this.settledListeners.push(listener);
		return () => {
			this.settledListeners = this.settledListeners.filter((entry) => entry !== listener);
		};
	}

	close(): void {
		this.store.close();
	}

	private persist(job: JobRecord): void {
		this.store.save(job);
	}

	private emit(job: JobRecord): void {
		for (const listener of this.updates) {
			try { listener(job); } catch { /* listener isolation */ }
		}
	}

	private emitSettled(job: JobRecord): void {
		for (const listener of this.settledListeners) {
			try { listener(job); } catch { /* listener isolation */ }
		}
	}
}

export const jobRegistry = new JobRegistry();
