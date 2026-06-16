/**
 * Single source of truth for builtin provider metadata.
 *
 * Replaces three previously independent maps:
 *   - BUILTIN_META in provider-dialog.tsx (name, desc, popular)
 *   - builtinNames in model-switcher.tsx (name only)
 *   - descs in provider-dialog.tsx (API key URLs)
 *
 * NOTE: The registry uses `openai-completions` and `openai-responses` as
 * provider IDs, but both represent the same logical "OpenAI" provider from
 * the user's perspective. Use `resolveProviderMeta()` to handle this mapping
 * transparently.
 */

export interface ProviderMeta {
	/** Human-readable display name. */
	name: string;
	/** Short description shown in the provider list. */
	desc: string;
	/** Whether to show under the "Popular" section (vs. "Providers"). */
	popular: boolean;
	/** URL where the user can obtain an API key. */
	apiKeyUrl?: string;
	/**
	 * Curated fallback model list for providers not present in the auto-generated
	 * model database (e.g. multi-model gateways). Shown when getModels() returns
	 * an empty array.
	 */
	defaultModels?: { id: string; name: string }[];
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
	// ── Popular providers ──────────────────────────────────────────────────────
	anthropic: {
		name: 'Anthropic',
		desc: 'Claude models',
		popular: true,
		apiKeyUrl: 'https://console.anthropic.com',
	},
	openai: {
		name: 'OpenAI',
		desc: 'GPT models',
		popular: true,
		apiKeyUrl: 'https://platform.openai.com',
	},
	openrouter: {
		name: 'OpenRouter',
		desc: 'Multi-model gateway',
		popular: true,
		apiKeyUrl: 'https://openrouter.ai/keys',
	},
	groq: {
		name: 'Groq',
		desc: 'Fast inference',
		popular: true,
		apiKeyUrl: 'https://console.groq.com',
	},
	xai: {
		name: 'xAI',
		desc: 'Grok models',
		popular: true,
		apiKeyUrl: 'https://x.ai/api',
	},
	deepseek: {
		name: 'DeepSeek',
		desc: 'DeepSeek models',
		popular: true,
		apiKeyUrl: 'https://platform.deepseek.com',
	},
	mistral: {
		name: 'Mistral',
		desc: 'Mistral models',
		popular: true,
		apiKeyUrl: 'https://console.mistral.ai',
	},
	cerebras: {
		name: 'Cerebras',
		desc: 'Fast inference',
		popular: true,
	},
	google: {
		name: 'Google',
		desc: 'Gemini models',
		popular: true,
		apiKeyUrl: 'https://aistudio.google.com/apikey',
	},

	// ── Standard providers ─────────────────────────────────────────────────────
	'fireworks-ai': {
		name: 'Fireworks AI',
		desc: 'Fast inference',
		popular: false,
	},
	togetherai: {
		name: 'Together AI',
		desc: 'Open-source models',
		popular: false,
	},
	perplexity: {
		name: 'Perplexity',
		desc: 'Search models',
		popular: false,
	},
	cohere: {
		name: 'Cohere',
		desc: 'Command models',
		popular: false,
	},
	'novita-ai': {
		name: 'Novita AI',
		desc: 'Inference API',
		popular: false,
	},
	moonshotai: {
		name: 'Moonshot AI',
		desc: 'Chinese models',
		popular: false,
	},
	chutes: {
		name: 'Chutes',
		desc: 'Inference API',
		popular: false,
	},
	minimax: {
		name: 'MiniMax',
		desc: 'MiniMax models',
		popular: false,
	},
	huggingface: {
		name: 'Hugging Face',
		desc: 'Open models',
		popular: false,
	},
	nvidia: {
		name: 'NVIDIA',
		desc: 'NVIDIA models',
		popular: false,
	},
	zai: {
		name: 'Z.AI',
		desc: 'Chinese models',
		popular: false,
	},

	// ── Coding plan / subscription providers ──────────────────────────────────
	'opencode-go': {
		name: 'OpenCode Go',
		desc: 'Open models $10/mo',
		popular: true,
		apiKeyUrl: 'https://opencode.ai/go',
	},
	'alibaba-coding-plan': {
		name: 'Qwen Coding Plan',
		desc: 'Qwen models',
		popular: false,
		apiKeyUrl: 'https://dashscope.console.aliyun.com',
	},
	'alibaba-coding-plan-cn': {
		name: 'Qwen Coding Plan (CN)',
		desc: 'Qwen models',
		popular: false,
		apiKeyUrl: 'https://dashscope.console.aliyun.com',
	},
	'minimax-coding-plan': {
		name: 'MiniMax Token Plan',
		desc: 'MiniMax models',
		popular: true,
		apiKeyUrl: 'https://platform.minimax.io',
	},
	'minimax-coding-plan-cn': {
		name: 'MiniMax Token Plan (CN)',
		desc: 'MiniMax models',
		popular: true,
		apiKeyUrl: 'https://platform.minimaxi.com',
	},
	'zai-coding-plan': {
		name: 'GLM Coding Plan',
		desc: 'GLM models',
		popular: false,
		apiKeyUrl: 'https://z.ai',
	},
	'zhipuai-coding-plan': {
		name: 'GLM Coding Plan (CN)',
		desc: 'GLM models',
		popular: false,
		apiKeyUrl: 'https://open.bigmodel.cn',
	},
	'kimi-coding-plan': {
		name: 'Kimi Code Plan',
		desc: 'Kimi K2 models',
		popular: true,
		apiKeyUrl: 'https://kimi.com/code',
	},
	'opencode-zen': {
		name: 'OpenCode Zen',
		desc: 'Multi-model pay-as-you-go',
		popular: false,
		apiKeyUrl: 'https://opencode.ai/zen',
		defaultModels: [
			{ id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
			{ id: 'claude-opus-4-5', name: 'Claude Opus 4.5' },
			{ id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
			{ id: 'gpt-4o', name: 'GPT-4o' },
			{ id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
			{ id: 'o3', name: 'o3' },
			{ id: 'o4-mini', name: 'o4-mini' },
			{ id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
			{ id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
			{ id: 'deepseek-r2', name: 'DeepSeek R2' },
			{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
			{ id: 'kimi-k2', name: 'Kimi K2' },
		],
	},
};

/**
 * Normalize a registry provider ID to its canonical metadata key.
 *
 * The registry stores OpenAI as two separate provider IDs
 * (`openai-completions`, `openai-responses`), but both resolve to the single
 * `openai` entry in PROVIDER_META so the user sees one "OpenAI" entry.
 */
export function resolveMetaKey(registryId: string): string {
	if (registryId === 'openai-completions' || registryId === 'openai-responses') {
		return 'openai';
	}
	return registryId;
}

/**
 * Look up the display name for a provider, falling back to custom provider
 * names and finally the raw ID.
 */
export function getProviderDisplayName(
	providerId: string,
	customProviders: Record<string, { name?: string }> = {},
): string {
	const custom = customProviders[providerId];
	if (custom?.name) return custom.name;
	const key = resolveMetaKey(providerId);
	return PROVIDER_META[key]?.name ?? providerId;
}

/**
 * Return the API key prompt description for a provider, or a generic fallback.
 */
export function getApiKeyDesc(providerId: string, providerName: string): string {
	const key = resolveMetaKey(providerId);
	const url = PROVIDER_META[key]?.apiKeyUrl;
	return url ? `Get your key at ${url}` : `Enter your ${providerName} API key`;
}
