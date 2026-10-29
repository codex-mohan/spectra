import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import type { ResolvedLspSettings } from './servers.js';
import type { Diagnostic } from './protocol.js';

const execFileAsync = promisify(execFile);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function severity(value: unknown): number {
	switch (value) {
		case 'error': return 1;
		case 'warning': return 2;
		case 'information':
		case 'info': return 3;
		default: return 4;
	}
}

function offsetToPosition(text: string, offset: number): { line: number; character: number } {
	const safe = Math.max(0, Math.min(offset, text.length));
	const before = text.slice(0, safe);
	const lines = before.split('\n');
	return { line: lines.length - 1, character: lines[lines.length - 1]?.length ?? 0 };
}

function parseBiome(output: string, file: string): Diagnostic[] {
	let payload: unknown;
	try {
		payload = JSON.parse(output);
	} catch {
		return [];
	}
	if (!isRecord(payload) || !Array.isArray(payload.diagnostics)) return [];

	let text = '';
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		text = '';
	}

	const diagnostics: Diagnostic[] = [];
	for (const item of payload.diagnostics) {
		if (!isRecord(item)) continue;
		const message = typeof item.message === 'string' ? item.message : '';
		if (!message) continue;
		const location = isRecord(item.location) ? item.location : undefined;
		const path = location && isRecord(location.path) && typeof location.path.file === 'string' ? location.path.file : undefined;
		if (path && !path.replaceAll('\\', '/').endsWith(file.replaceAll('\\', '/').split('/').pop() ?? '')) continue;

		let range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
		if (location && Array.isArray(location.span) && location.span.length >= 2) {
			const start = Number(location.span[0]);
			const end = Number(location.span[1]);
			if (Number.isFinite(start) && Number.isFinite(end)) {
				range = { start: offsetToPosition(text, start), end: offsetToPosition(text, end) };
			}
		}
		diagnostics.push({
			range,
			severity: severity(item.severity),
			message,
			source: 'biome',
			...(typeof item.category === 'string' ? { code: item.category } : {}),
		});
	}
	return diagnostics;
}

/** Run configured CLI linters for one file. Missing binaries are skipped. */
export async function collectLinterDiagnostics(path: string, settings: ResolvedLspSettings): Promise<Diagnostic[]> {
	const biome = settings.linters.biome;
	if (biome.enabled === false) return [];

	const command = biome.command ?? 'biome';
	const args = [...(biome.args ?? ['check', '--reporter=json']), path];
	try {
		const { stdout } = await execFileAsync(command, args, {
			timeout: 10_000,
			maxBuffer: 2 * 1024 * 1024,
			windowsHide: true,
		});
		return parseBiome(stdout, path);
	} catch (error) {
		const stdout = isRecord(error) && typeof error.stdout === 'string' ? error.stdout : '';
		return stdout ? parseBiome(stdout, path) : [];
	}
}
