import type { Credential } from './auth-store.js';

export interface ProviderConnectionConfig {
	apiKey?: string;
}

export function isCredentialConnected(
	credential: Credential | undefined,
	customProvider?: ProviderConnectionConfig,
	now = Date.now(),
): boolean {
	if (credential?.type === 'api') return credential.key.length > 0;
	if (credential?.type === 'oauth') return credential.expires > now;
	return Boolean(customProvider?.apiKey);
}
