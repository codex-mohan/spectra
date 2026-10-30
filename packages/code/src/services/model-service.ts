/**
 * UI-facing service that bridges auth-store credentials with model-catalog
 * resolution and provider header derivation.
 *
 * Centralises two concerns that were previously scattered across provider-dialog,
 * model-switcher, and use-agent:
 *
 * 1. Model catalog resolution – credential-aware, cache-backed model discovery.
 * 2. Provider request headers – Codex account identity, Snowflake/Copilot
 *    integration headers, OpenCode gateway session routing, local providers
 *    get nothing.
 */

import type { Credential } from './auth-store.js';
import { read as readCredential } from './auth-store.js';
import { resolveModelCatalog, type ResolveModelCatalogOptions } from './model-catalog.js';
import type { DiscoveryContext } from '@mohanscodex/spectra-ai';
import { getModels } from '@mohanscodex/spectra-ai';
import { APP_USER_AGENT } from './app-version.js';

// ── OpenCode Zen gateway routing ────────────────────────────────────────────

/**
 * Providers served by the OpenCode Zen gateway (`opencode.ai/zen`).
 * The gateway routes requests by conversation and expects clients to identify
 * themselves, so it rejects conversation traffic that arrives without a stable
 * `x-opencode-session` id.
 * @see https://opencode.ai/docs/go/#where-can-i-use-it
 */
const OPENCODE_GATEWAY_PROVIDERS: Readonly<Record<string, true>> = {
	'opencode-go': true,
	'opencode-zen': true,
};

/**
 * Headers required by the OpenCode Zen gateway.
 *
 * `sessionId` is the conversation id. Omit it for non-conversation traffic
 * (model discovery), where only the client identity is sent. The gateway
 * requires a client-specific `User-Agent` rather than a generic SDK or
 * HTTP-library default.
 */
export function opencodeGatewayHeaders(sessionId?: string): Record<string, string> {
	const headers: Record<string, string> = { 'User-Agent': APP_USER_AGENT };
	if (sessionId) headers['x-opencode-session'] = sessionId;
	return headers;
}

// ── Discovery context from credentials ──────────────────────────────────────

/**
 * Build a DiscoveryContext from a stored credential.
 * Returns `undefined` for local providers (no auth / fake bearer token).
 */
export function buildDiscoveryContext(
	providerId: string,
	credential?: Credential,
): DiscoveryContext | undefined {
	if (!credential || credential.type === 'wellknown') return undefined;

	const headers: Record<string, string> = {};
	if (providerId === 'openai-codex' && credential.type === 'oauth' && credential.accountId) {
		headers['ChatGPT-Account-Id'] = credential.accountId;
	}
	if (OPENCODE_GATEWAY_PROVIDERS[providerId]) {
		// Model discovery is not a conversation – client identity only.
		Object.assign(headers, opencodeGatewayHeaders());
	}

	return {
		apiKey: credential.type === 'api' ? credential.key : credential.access,
		headers,
	};
}

// ── Model catalog resolution for UI ─────────────────────────────────────────

export interface ResolveModelsForProviderOptions {
	/** Override discovery function (for testing). */
	discoverModels?: ResolveModelCatalogOptions['discoverModels'];
	/** Current timestamp in ms (for testing). */
	nowMs?: number;
}

/**
 * Resolve the model list for a builtin provider using credential-aware
 * catalog resolution.  Returns a simple `{ id, name }[]` array suitable
 * for UI consumption.
 *
 * Falls back to bundled + cached models when discovery fails or when
 * no credential is present (local providers).
 *
 * Only `openai-codex` is marked authoritative so its live list is the
 * ground truth; all other builtins keep bundled fallbacks visible.
 */
export async function resolveModelsForProvider(
	providerId: string,
	options?: ResolveModelsForProviderOptions,
): Promise<{ id: string; name: string }[]> {
	const credential = readCredential(providerId);
	const context = buildDiscoveryContext(providerId, credential);

	const accountId =
		credential?.type === 'oauth' ? credential.accountId : undefined;

	try {
		const result = await resolveModelCatalog({
			providerId,
			credentialContext: context,
			accountId,
			authoritative: providerId === 'openai-codex',
			...options,
		});
		return result.models.map((model) => ({ id: model.id, name: model.name }));
	} catch {
		return (await getModels(providerId)).map((model) => ({ id: model.id, name: model.name }));
	}
}

// ── Provider request headers ────────────────────────────────────────────────

/** Bearer header for OAuth or API-key credentials. */
function authBearerHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

/**
 * Derive the request headers for a provider, given its credential.
 *
 * Rules:
 * - Local providers (no credential / well-known) → `{}` (no auth header).
 * - Codex OAuth with accountId → adds `ChatGPT-Account-Id`.
 * - Snowflake OAuth → adds `X-Snowflake-Authorization-Token-Type`.
 * - GitHub Copilot → adds VS Code integration headers.
 * - OpenCode Go/Zen → client User-Agent, plus `x-opencode-session` when a
 *   conversation id is supplied (the gateway rejects traffic without it).
 * - All other credential types → Bearer token only.
 *
 * `existingHeaders` are custom-provider headers that should be preserved
 * (spread first by the caller, then this function adds provider-specific
 * headers on top).
 *
 * `sessionId` is the conversation id used for gateway routing. Callers that
 * have no conversation (e.g. one-shot tooling) may omit it.
 */
export function resolveProviderHeaders(
	providerId: string,
	credential: Credential | undefined,
	existingHeaders?: Record<string, string>,
	sessionId?: string,
): Record<string, string> | undefined {
	const headers: Record<string, string> = { ...existingHeaders };

	// ── Bearer token ──
	if (credential?.type === 'api') {
		Object.assign(headers, authBearerHeader(credential.key));
	} else if (credential?.type === 'oauth' && credential.expires > Date.now()) {
		Object.assign(headers, authBearerHeader(credential.access));
	} else if (!credential || credential.type === 'wellknown') {
		// Local / no-auth provider – no authorization header
	}

	// ── Provider-specific headers (only for builtins, not custom providers) ──

	if (providerId === 'openai-codex' && credential?.type === 'oauth' && credential.accountId) {
		headers['ChatGPT-Account-Id'] = credential.accountId;
		headers['User-Agent'] = APP_USER_AGENT;
	}

	if (providerId === 'snowflake-cortex' && credential?.type === 'oauth' && credential.accountId) {
		headers['X-Snowflake-Authorization-Token-Type'] = 'OAUTH';
	}

	if (OPENCODE_GATEWAY_PROVIDERS[providerId]) {
		Object.assign(headers, opencodeGatewayHeaders(sessionId));
	}

	if (providerId === 'github-copilot') {
		headers['Copilot-Integration-Id'] = 'vscode-chat';
		headers['Editor-Version'] = 'vscode/1.109.2';
		headers['Editor-Plugin-Version'] = 'copilot-chat/0.37.5';
		headers['User-Agent'] = 'GitHubCopilotChat/0.37.5';
		headers['X-GitHub-Api-Version'] = '2025-10-01';
		headers['x-initiator'] = 'user';
		headers['Openai-Intent'] = 'conversation-agent';
	}

	// Return undefined if the headers object is empty (no auth, no provider-specific)
	return Object.keys(headers).length > 0 ? headers : undefined;
}
