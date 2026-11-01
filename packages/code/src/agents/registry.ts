import type { Model } from '@mohanscodex/spectra-ai';
import type { SafetyConfig } from '../services/config.js';

export interface AgentRegistryConfig {
	model: Model;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	safety?: SafetyConfig;
}

let currentConfig: AgentRegistryConfig | null = null;

export const AgentRegistry = {
	setConfig(config: AgentRegistryConfig) {
		currentConfig = config;
	},
	getConfig(): AgentRegistryConfig | null {
		return currentConfig;
	},
	clear() {
		currentConfig = null;
	},
};
