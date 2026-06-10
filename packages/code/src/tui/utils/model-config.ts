import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getGlobalConfigDir } from '../../utils/paths.js';
import { readAll } from '../../services/auth-store.js';
import { getProviderModels } from '@mohanscodex/spectra-ai';

export function loadSavedConfig(): { model: string | null; provider: string | null } {
	try {
		const configPath = join(getGlobalConfigDir(), 'spectra.json');
		if (!existsSync(configPath)) return { model: null, provider: null };
		const cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
		return { model: cfg.model || null, provider: cfg.provider || null };
	} catch {
		return { model: null, provider: null };
	}
}

export function getAuthKey(providerId: string): string | undefined {
	const cred = readAll()[providerId];
	return cred?.type === 'api' ? cred.key : undefined;
}

export function saveModelConfig(modelId: string, providerId: string) {
	try {
		const configDir = getGlobalConfigDir();
		if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
		const configPath = join(configDir, 'spectra.json');
		let cfg: Record<string, unknown> = {};
		try {
			cfg = JSON.parse(readFileSync(configPath, 'utf-8'));
		} catch {}
		cfg.model = modelId;
		cfg.provider = providerId;
		writeFileSync(configPath, JSON.stringify(cfg, null, 2));
	} catch {}
}

export function fmtCtx(n: number): string {
	if (n < 1000) return String(n);
	const k = n / 1000;
	const s = k.toFixed(1);
	return (s.endsWith('.0') ? s.slice(0, -2) : s) + 'K';
}

export function lookupContextWindow(modelId: string, providerId: string | null): number | undefined {
	if (!providerId) return undefined;
	const models = getProviderModels(providerId);
	const exact = models.find((m) => m.id === modelId);
	if (exact?.contextWindow) return exact.contextWindow;
	const base = modelId.replace(/-\d{8}$/, '');
	const prefix = models.find((m) => m.id === base || m.id === `${providerId}/${base}`);
	if (prefix?.contextWindow) return prefix.contextWindow;
	const family = base.replace(/-\d+$/, '');
	const partial = models.find((m) => m.id === family || m.id.endsWith(`/${family}`));
	if (partial?.contextWindow) return partial.contextWindow;
	return undefined;
}
