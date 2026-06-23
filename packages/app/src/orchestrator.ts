import { runSubagent } from '@mohanscodex/spectra-agent';
import type { AgentTool } from '@mohanscodex/spectra-agent';
import type { Model } from '@mohanscodex/spectra-ai';
import type { Budget, DelegateOptions, DelegationResult, TaskConfig } from './types.js';
import type { SessionManager } from './session-manager.js';

interface AgentRegistryEntry {
	model?: Model;
	systemPrompt?: string;
	tools?: AgentTool[];
}

export class AgentRegistry {
	private agents: Map<string, AgentRegistryEntry> = new Map();

	constructor(private sessionManager?: SessionManager) {}

	registerAgent(agentType: string, config: AgentRegistryEntry): void {
		this.agents.set(agentType, config);
	}

	async delegate(agentType: string, task: string, opts?: DelegateOptions): Promise<DelegationResult> {
		const agentConfig = this.agents.get(agentType);
		if (!agentConfig) {
			return {
				agentType,
				success: false,
				result: '',
				error: `Unknown agent type: ${agentType}`,
			};
		}

		const resolvedModel = opts?.parentModel ?? agentConfig.model;
		if (!resolvedModel) {
			return {
				agentType,
				success: false,
				result: '',
				error: `No model available: agent "${agentType}" has no model and no parentModel provided`,
			};
		}

		try {
			const result = await runSubagent(
				{
					model: resolvedModel,
					modelOverride: agentConfig.model,
					systemPrompt: agentConfig.systemPrompt,
					tools: opts?.tools ?? agentConfig.tools,
					budget: opts?.budget,
					signal: opts?.signal,
					onEvent: opts?.onEvent,
				},
				task,
			);

			let childSessionId: string | undefined;

			if (this.sessionManager) {
				const childSession = await this.sessionManager.create({ model: resolvedModel });
				if (opts?.parentSessionId) {
					childSession.metadata.parentSessionId = opts.parentSessionId;
				}
				for (const msg of result.messages) {
					this.sessionManager.appendMessage(childSession, msg);
				}
				await this.sessionManager.save(childSession);
				childSessionId = childSession.id;
			}

			return {
				agentType,
				success: !result.error && !result.aborted,
				result: result.text,
				messages: result.messages,
				childSessionId,
				usage: result.usage,
				error: result.error,
			};
		} catch (err) {
			return {
				agentType,
				success: false,
				result: '',
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}

	async executeParallel(
		tasks: TaskConfig[],
		opts?: Pick<DelegateOptions, 'parentModel' | 'parentSessionId' | 'signal'>,
	): Promise<DelegationResult[]> {
		const promises = tasks.map((task) =>
			this.delegate(task.agentType, task.task, {
				...opts,
				tools: task.tools,
				budget: task.budget,
			}),
		);
		return Promise.all(promises);
	}
}
