import type { Agent } from '@mohanscodex/spectra-agent';

export interface JobHandle {
	pause(): boolean;
	cancel(): boolean;
	send(message: string): boolean;
	resume(instruction?: string): Promise<void>;
	restart(from: 'start' | 'checkpoint'): Promise<void>;
	currentActivity(): string | undefined;
}

const handles = new Map<string, JobHandle>();
const activeAgents = new Map<string, Agent>();

export function registerJobHandle(jobId: string, handle: JobHandle): void {
	handles.set(jobId, handle);
}

export function unregisterJobHandle(jobId: string): void {
	handles.delete(jobId);
	activeAgents.delete(jobId);
}

export function getJobHandle(jobId: string): JobHandle | undefined {
	return handles.get(jobId);
}

export function setActiveAgent(jobId: string, agent: Agent): void {
	activeAgents.set(jobId, agent);
}

export function clearActiveAgent(jobId: string): void {
	activeAgents.delete(jobId);
}

export function getActiveAgent(jobId: string): Agent | undefined {
	return activeAgents.get(jobId);
}
