import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getGlobalConfigDir } from '../../utils/paths.js';
import { VERSION } from './version.js';

interface CacheEntry {
	lastCheck: number;
	latestVersion: string;
}

function getCachePath(): string {
	const dir = getGlobalConfigDir();
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, 'last-check.json');
}

function readCache(): CacheEntry | null {
	try {
		const path = getCachePath();
		if (!existsSync(path)) return null;
		const data = JSON.parse(readFileSync(path, 'utf-8'));
		if (data.lastCheck && data.latestVersion) return data;
	} catch {}
	return null;
}

function writeCache(version: string): void {
	try {
		writeFileSync(
			getCachePath(),
			JSON.stringify({ lastCheck: Date.now(), latestVersion: version }),
			'utf-8',
		);
	} catch {}
}

function isNewer(latest: string, current: string): boolean {
	const l = latest.split('.').map(Number);
	const c = current.split('.').map(Number);
	for (let i = 0; i < 3; i++) {
		if ((l[i] || 0) > (c[i] || 0)) return true;
		if ((l[i] || 0) < (c[i] || 0)) return false;
	}
	return false;
}

export async function checkForUpdate(): Promise<string | null> {
	try {
		const cached = readCache();
		if (cached && Date.now() - cached.lastCheck < 24 * 60 * 60 * 1000) {
			return isNewer(cached.latestVersion, VERSION) ? cached.latestVersion : null;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 3000);

		const res = await fetch('https://registry.npmjs.org/@mohanscodex/spectra-code/latest', {
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!res.ok) return null;

		const json = (await res.json()) as { version?: string };
		const latest = json.version;
		if (!latest) return null;

		writeCache(latest);

		return isNewer(latest, VERSION) ? latest : null;
	} catch {
		return null;
	}
}
