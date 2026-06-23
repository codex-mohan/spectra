import type { Message } from '@mohanscodex/spectra-ai';

export type BackgroundTaskStatus = 'running' | 'completed' | 'error' | 'cancelled';

export interface BackgroundTask {
	id: string;
	parentSessionId: string;
	agentType: string;
	description: string;
	status: BackgroundTaskStatus;
	result?: string;
	messages?: Message[];
	error?: string;
	startedAt: number;
	completedAt?: number;
	background: boolean;
}

export type BackgroundTaskEvent = BackgroundTask;
export type BackgroundTaskListener = (task: BackgroundTask) => void;

export class BackgroundTaskRegistry {
	private tasks = new Map<string, BackgroundTask>();
	private listeners: BackgroundTaskListener[] = [];
	private completionListeners: BackgroundTaskListener[] = [];
	private promoted = new Set<string>();
	private pendingExtensions = new Map<string, string[]>();

	start(task: BackgroundTask): void {
		this.tasks.set(task.id, task);
		this.emit(task);
	}

	complete(taskId: string, result: string, messages: Message[]): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		task.status = 'completed';
		task.result = result;
		task.messages = messages;
		task.completedAt = Date.now();
		this.emit(task);
		for (const listener of this.completionListeners) {
			try {
				listener(task);
			} catch {}
		}
	}

	error(taskId: string, error: string): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		task.status = 'error';
		task.error = error;
		task.completedAt = Date.now();
		this.emit(task);
		for (const listener of this.completionListeners) {
			try {
				listener(task);
			} catch {}
		}
	}

	cancel(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task) return;
		task.status = 'cancelled';
		task.completedAt = Date.now();
		this.emit(task);
	}

	promote(taskId: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task || task.status !== 'running') return false;
		this.promoted.add(taskId);
		task.background = true;
		this.emit(task);
		return true;
	}

	isPromoted(taskId: string): boolean {
		return this.promoted.has(taskId);
	}

	extend(taskId: string, prompt: string): boolean {
		const task = this.tasks.get(taskId);
		if (!task || task.status !== 'running') return false;
		const queue = this.pendingExtensions.get(taskId) || [];
		queue.push(prompt);
		this.pendingExtensions.set(taskId, queue);
		return true;
	}

	drainExtensions(taskId: string): string[] {
		const queue = this.pendingExtensions.get(taskId) || [];
		this.pendingExtensions.delete(taskId);
		return queue;
	}

	get(taskId: string): BackgroundTask | undefined {
		return this.tasks.get(taskId);
	}

	getAll(): BackgroundTask[] {
		return Array.from(this.tasks.values());
	}

	getRunningForParent(parentSessionId: string): BackgroundTask[] {
		const out: BackgroundTask[] = [];
		for (const task of this.tasks.values()) {
			if (task.parentSessionId === parentSessionId && task.status === 'running') out.push(task);
		}
		return out;
	}

	onUpdate(listener: BackgroundTaskListener): () => void {
		this.listeners.push(listener);
		return () => {
			const idx = this.listeners.indexOf(listener);
			if (idx >= 0) this.listeners.splice(idx, 1);
		};
	}

	onCompletion(listener: BackgroundTaskListener): () => void {
		this.completionListeners.push(listener);
		return () => {
			const idx = this.completionListeners.indexOf(listener);
			if (idx >= 0) this.completionListeners.splice(idx, 1);
		};
	}

	private emit(task: BackgroundTask): void {
		for (const listener of this.listeners) {
			try {
				listener(task);
			} catch {}
		}
	}
}

export const backgroundTasks = new BackgroundTaskRegistry();