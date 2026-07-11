import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getGlobalDataDir } from '../utils/paths.js';
import { readAll, write as writeCredential, type Credential } from './auth-store.js';
import { refreshKimiCode, refreshCodexToken } from './provider-auth.js';
import { refreshGitHubCopilotToken } from './github-copilot-auth.js';
import { refreshXaiToken } from './xai-auth.js';
import { refreshSnowflakeCortexToken } from './snowflake-cortex-auth.js';

export type UsageUnit = 'usd' | 'tokens' | 'requests' | 'percent' | 'unknown';
export type UsageStatus = 'ok' | 'warning' | 'exhausted' | 'unknown';
export type UsageSource = 'live' | 'observed-costs' | 'observed-tokens' | 'untracked';

export interface UsageCostEntry {
	recordedAt: number;
	provider: string;
	model: string;
	sessionId?: string;
	inputTokens: number;
	outputTokens: number;
	costUsd: number;
}

export interface UsageWindowLimit {
	id: string;
	label: string;
	durationMs: number;
	limit: number;
	unit: UsageUnit;
}

export interface UsageWindow {
	id: string;
	label: string;
	durationMs?: number;
	resetsAt?: number;
}

export interface UsageAmount {
	used?: number;
	limit?: number;
	remaining?: number;
	usedFraction?: number;
	remainingFraction?: number;
	unit: UsageUnit;
}

export interface UsageScope {
	provider: string;
	accountId?: string;
	projectId?: string;
	modelId?: string;
	tier?: string;
	windowId?: string;
	shared?: boolean;
}

export interface UsageLimit {
	id: string;
	label: string;
	scope: UsageScope;
	window?: UsageWindow;
	amount: UsageAmount;
	status: UsageStatus;
	notes?: string[];
}

export interface UsageReport {
	provider: string;
	fetchedAt: number;
	limits: UsageLimit[];
	metadata?: Record<string, unknown>;
	notes?: string[];
	raw?: unknown;
}

export interface UsageWindowReport {
	id: string;
	label: string;
	used: number;
	limit: number;
	remaining: number;
	usedFraction: number;
	unit: UsageUnit;
	status: UsageStatus;
	resetsAt?: number;
	accountLabel?: string;
	notes?: string[];
}

export interface ProviderUsageReport {
	provider: string;
	planName: string;
	source: UsageSource;
	entries: number;
	totalCostUsd: number;
	totalTokens: number;
	windows: UsageWindowReport[];
	notes: string[];
	fetchedAt?: number;
	accountLabel?: string;
}

interface UsageProvider {
	id: string;
	supports(provider: string, credential: Credential | undefined): boolean;
	fetchUsage(args: UsageProviderArgs): Promise<UsageReport | null>;
}

interface UsageProviderArgs {
	provider: string;
	credential: Credential;
	baseUrl: string;
	nowMs: number;
	signal?: AbortSignal;
	fetchImpl: typeof fetch;
}

export interface FetchUsageReportsOptions {
	providers?: string[];
	nowMs?: number;
	signal?: AbortSignal;
	fetchImpl?: typeof fetch;
	dataDir?: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const KIMI_REFRESH_SKEW_MS = 60 * 1000;

export const CODING_PLAN_LIMITS: Record<string, { name: string; windows: UsageWindowLimit[]; notes: string[] }> = {
	'opencode-go': {
		name: 'OpenCode Go',
		windows: [
			{ id: '5h', label: '5 Hour', durationMs: 5 * HOUR_MS, limit: 12, unit: 'usd' },
			{ id: '7d', label: 'Weekly', durationMs: 7 * DAY_MS, limit: 30, unit: 'usd' },
			{ id: '30d', label: 'Monthly', durationMs: 30 * DAY_MS, limit: 60, unit: 'usd' },
		],
		notes: ['Spectra-observed spend only; usage outside Spectra is not included.'],
	},
	'opencode-zen': {
		name: 'OpenCode Zen',
		windows: [],
		notes: ['Pay-as-you-go plan; no fixed quota windows are tracked locally.'],
	},
	'minimax-coding-plan': {
		name: 'MiniMax Token Plan',
		windows: [],
		notes: ['MiniMax does not expose a usage/quota endpoint for this plan yet.'],
	},
	'minimax-coding-plan-cn': {
		name: 'MiniMax Token Plan (CN)',
		windows: [],
		notes: ['MiniMax does not expose a usage/quota endpoint for this plan yet.'],
	},
	'minimax-code': {
		name: 'MiniMax Token Plan',
		windows: [],
		notes: ['MiniMax does not expose a usage/quota endpoint for this plan yet.'],
	},
	'minimax-code-cn': {
		name: 'MiniMax Token Plan (CN)',
		windows: [],
		notes: ['MiniMax does not expose a usage/quota endpoint for this plan yet.'],
	},
	'zai-coding-plan': { name: 'GLM Coding Plan', windows: [], notes: [] },
	'zhipuai-coding-plan': { name: 'GLM Coding Plan (CN)', windows: [], notes: [] },
	'zhipu-coding-plan': { name: 'Zhipu Coding Plan', windows: [], notes: [] },
	'kimi-coding-plan': { name: 'Kimi Code Plan', windows: [], notes: [] },
	'kimi-code': { name: 'Kimi Code', windows: [], notes: [] },
	'alibaba-coding-plan': {
		name: 'Qwen Coding Plan',
		windows: [],
		notes: ['Qwen coding-plan usage endpoint is not implemented yet.'],
	},
	'alibaba-coding-plan-cn': {
		name: 'Qwen Coding Plan (CN)',
		windows: [],
		notes: ['Qwen coding-plan usage endpoint is not implemented yet.'],
	},
};

const PROVIDER_BASE_URLS: Record<string, string> = {
	'opencode-go': 'https://opencode.ai/zen/go/v1',
	'opencode-zen': 'https://opencode.ai/zen/v1',
	'alibaba-coding-plan': 'https://coding-intl.dashscope.aliyuncs.com/v1',
	'alibaba-coding-plan-cn': 'https://coding.dashscope.aliyuncs.com/v1',
	'minimax-coding-plan': 'https://api.minimax.io/v1',
	'minimax-coding-plan-cn': 'https://api.minimaxi.com/v1',
	'minimax-code': 'https://api.minimax.io/v1',
	'minimax-code-cn': 'https://api.minimaxi.com/v1',
	'zai-coding-plan': 'https://api.z.ai/api/coding/paas/v4',
	'zhipuai-coding-plan': 'https://open.bigmodel.cn/api/paas/v4',
	'zhipu-coding-plan': 'https://open.bigmodel.cn/api/coding/paas/v4',
	'kimi-coding-plan': 'https://api.kimi.com/coding/v1',
	'kimi-code': 'https://api.kimi.com/coding/v1',
};

function usageFilePath(dataDir = getGlobalDataDir()): string {
	return join(dataDir, 'usage.json');
}

function usageCachePath(dataDir = getGlobalDataDir()): string {
	return join(dataDir, 'usage-cache.json');
}

function ensureDataDir(dataDir = getGlobalDataDir()): void {
	if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function parseEntries(raw: unknown): UsageCostEntry[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter((entry): entry is UsageCostEntry => {
		if (!entry || typeof entry !== 'object') return false;
		const value = entry as Record<string, unknown>;
		return typeof value.recordedAt === 'number'
			&& typeof value.provider === 'string'
			&& typeof value.model === 'string'
			&& typeof value.inputTokens === 'number'
			&& typeof value.outputTokens === 'number'
			&& typeof value.costUsd === 'number';
	});
}

export function readUsageEntries(dataDir?: string): UsageCostEntry[] {
	try {
		return parseEntries(JSON.parse(readFileSync(usageFilePath(dataDir), 'utf-8')));
	} catch {
		return [];
	}
}

export function writeUsageEntries(entries: UsageCostEntry[], dataDir?: string): void {
	const dir = dataDir ?? getGlobalDataDir();
	ensureDataDir(dir);
	writeFileSync(usageFilePath(dir), JSON.stringify(entries, null, 2), { mode: 0o600, encoding: 'utf-8' });
}

export function recordUsageCost(entry: UsageCostEntry, dataDir?: string): void {
	const entries = readUsageEntries(dataDir);
	entries.push(entry);
	writeUsageEntries(entries, dataDir);
}

function parseCachedReports(raw: unknown): Record<string, UsageReport> {
	if (!isRecord(raw)) return {};
	const reports: Record<string, UsageReport> = {};
	for (const [provider, value] of Object.entries(raw)) {
		if (!isRecord(value) || typeof value.provider !== 'string' || typeof value.fetchedAt !== 'number' || !Array.isArray(value.limits)) continue;
		reports[provider] = value as unknown as UsageReport;
	}
	return reports;
}

function readUsageCache(dataDir?: string): Record<string, UsageReport> {
	try {
		return parseCachedReports(JSON.parse(readFileSync(usageCachePath(dataDir), 'utf-8')));
	} catch {
		return {};
	}
}

function writeUsageCache(cache: Record<string, UsageReport>, dataDir?: string): void {
	const dir = dataDir ?? getGlobalDataDir();
	ensureDataDir(dir);
	writeFileSync(usageCachePath(dir), JSON.stringify(cache, null, 2), { mode: 0o600, encoding: 'utf-8' });
}

function statusFor(fraction: number | undefined): UsageStatus {
	if (fraction === undefined || !Number.isFinite(fraction)) return 'unknown';
	if (fraction >= 1) return 'exhausted';
	if (fraction >= 0.8) return 'warning';
	return 'ok';
}

function liveStatusFor(fraction: number | undefined): UsageStatus {
	if (fraction === undefined || !Number.isFinite(fraction)) return 'unknown';
	if (fraction >= 1) return 'exhausted';
	if (fraction >= 0.9) return 'warning';
	return 'ok';
}

function amountFromValues(args: { used?: number; limit?: number; remaining?: number; unit: UsageUnit; percentage?: number }): UsageAmount {
	const usedFraction = args.percentage !== undefined
		? Math.min(Math.max(args.percentage / 100, 0), 1)
		: args.used !== undefined && args.limit !== undefined && args.limit > 0
			? Math.min(Math.max(args.used / args.limit, 0), 1)
			: undefined;
	const remaining = args.remaining ?? (args.used !== undefined && args.limit !== undefined ? Math.max(0, args.limit - args.used) : undefined);
	return {
		unit: args.unit,
		...(args.used !== undefined ? { used: args.used } : {}),
		...(args.limit !== undefined ? { limit: args.limit } : {}),
		...(remaining !== undefined ? { remaining } : {}),
		...(usedFraction !== undefined ? { usedFraction, remainingFraction: Math.max(0, 1 - usedFraction) } : {}),
	};
}

function sumWindow(entries: UsageCostEntry[], window: UsageWindowLimit, nowMs: number): { used: number; resetsAt?: number } {
	const sinceMs = nowMs - window.durationMs;
	let used = 0;
	let firstRecordedAt: number | undefined;
	for (const entry of entries) {
		if (entry.recordedAt < sinceMs) continue;
		used += window.unit === 'usd' ? entry.costUsd : entry.inputTokens + entry.outputTokens;
		if (firstRecordedAt === undefined || entry.recordedAt < firstRecordedAt) firstRecordedAt = entry.recordedAt;
	}
	return { used, resetsAt: firstRecordedAt === undefined ? undefined : firstRecordedAt + window.durationMs };
}

function accountLabel(scope?: UsageScope, metadata?: Record<string, unknown>): string {
	const email = typeof metadata?.email === 'string' ? metadata.email : undefined;
	const accountId = scope?.accountId ?? (typeof metadata?.accountId === 'string' ? metadata.accountId : undefined);
	const projectId = scope?.projectId ?? (typeof metadata?.projectId === 'string' ? metadata.projectId : undefined);
	return email ?? accountId ?? projectId ?? 'account 1';
}

function unitLimit(unit: UsageUnit): number {
	return unit === 'percent' ? 100 : 0;
}

function usageWindowReportFromLimit(limit: UsageLimit, report: UsageReport): UsageWindowReport {
	const amount = limit.amount;
	const used = amount.used ?? (amount.usedFraction !== undefined ? amount.usedFraction * unitLimit(amount.unit) : 0);
	const limitValue = amount.limit ?? unitLimit(amount.unit);
	const remaining = amount.remaining ?? (amount.remainingFraction !== undefined ? amount.remainingFraction * limitValue : Math.max(0, limitValue - used));
	const usedFraction = amount.usedFraction ?? (limitValue > 0 ? used / limitValue : 0);
	return {
		id: limit.id,
		label: limit.label,
		used,
		limit: limitValue,
		remaining,
		usedFraction,
		unit: amount.unit,
		status: limit.status,
		resetsAt: limit.window?.resetsAt,
		accountLabel: accountLabel(limit.scope, report.metadata),
		notes: limit.notes,
	};
}

function providerName(provider: string): string {
	return CODING_PLAN_LIMITS[provider]?.name ?? provider;
}

export function buildProviderUsageReport(
	provider: string,
	entries: UsageCostEntry[],
	nowMs = Date.now(),
): ProviderUsageReport {
	const plan = CODING_PLAN_LIMITS[provider];
	const providerEntries = entries.filter((entry) => entry.provider === provider);
	const totalCostUsd = providerEntries.reduce((sum, entry) => sum + entry.costUsd, 0);
	const totalTokens = providerEntries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0);
	const windows = (plan?.windows ?? []).map((window) => {
		const { used, resetsAt } = sumWindow(providerEntries, window, nowMs);
		const roundedUsed = window.unit === 'usd' ? Number(used.toFixed(6)) : Math.round(used);
		const usedFraction = window.limit > 0 ? roundedUsed / window.limit : 0;
		return {
			id: window.id,
			label: window.label,
			used: roundedUsed,
			limit: window.limit,
			remaining: Math.max(0, window.limit - roundedUsed),
			usedFraction,
			unit: window.unit,
			status: statusFor(usedFraction),
			resetsAt,
			accountLabel: 'account 1',
		};
	});

	return {
		provider,
		planName: providerName(provider),
		source: windows.length > 0 ? 'observed-costs' : providerEntries.length > 0 ? 'observed-tokens' : 'untracked',
		entries: providerEntries.length,
		totalCostUsd,
		totalTokens,
		windows,
		notes: plan?.notes ?? [],
	};
}

export function buildUsageReports(providers: string[], entries = readUsageEntries(), nowMs = Date.now()): ProviderUsageReport[] {
	const providerSet = new Set([...providers, ...entries.map((entry) => entry.provider)]);
	return [...providerSet]
		.filter((provider) => provider in CODING_PLAN_LIMITS || entries.some((entry) => entry.provider === provider))
		.sort((a, b) => a.localeCompare(b))
		.map((provider) => buildProviderUsageReport(provider, entries, nowMs));
}

function reportFromLiveUsage(report: UsageReport, entries: UsageCostEntry[]): ProviderUsageReport {
	const providerEntries = entries.filter((entry) => entry.provider === report.provider);
	return {
		provider: report.provider,
		planName: providerName(report.provider),
		source: 'live',
		entries: providerEntries.length,
		totalCostUsd: providerEntries.reduce((sum, entry) => sum + entry.costUsd, 0),
		totalTokens: providerEntries.reduce((sum, entry) => sum + entry.inputTokens + entry.outputTokens, 0),
		windows: report.limits.map((limit) => usageWindowReportFromLimit(limit, report)),
		notes: report.notes ?? [],
		fetchedAt: report.fetchedAt,
		accountLabel: accountLabel(report.limits[0]?.scope, report.metadata),
	};
}

function fallbackReportWithNote(provider: string, entries: UsageCostEntry[], note: string, nowMs: number): ProviderUsageReport {
	const report = buildProviderUsageReport(provider, entries, nowMs);
	return { ...report, notes: [...report.notes, note] };
}

function normalizeBaseUrl(url: string): string {
	return url.trim().replace(/\/+$/, '');
}

function providerBaseUrl(provider: string): string {
	const envName = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_BASE_URL`;
	return normalizeBaseUrl(process.env[envName] || PROVIDER_BASE_URLS[provider] || '');
}

function parseMillis(value: unknown): number | undefined {
	const parsed = toNumber(value);
	if (parsed === undefined) return undefined;
	return parsed > 1_000_000_000_000 ? parsed : parsed * 1000;
}

function durationLabel(duration: number, unit: string): string | undefined {
	const upper = unit.toUpperCase();
	if (upper.includes('MINUTE')) return duration >= 60 && duration % 60 === 0 ? `${duration / 60}h limit` : `${duration}m limit`;
	if (upper.includes('HOUR')) return `${duration}h limit`;
	if (upper.includes('DAY')) return `${duration}d limit`;
	if (upper.includes('SECOND')) return `${duration}s limit`;
	return undefined;
}

function parseResetTime(data: Record<string, unknown>, nowMs: number): number | undefined {
	for (const key of ['reset_at', 'resetAt', 'reset_time', 'resetTime']) {
		const value = data[key];
		if (typeof value === 'string' && value.trim()) {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) return parsed;
		}
		const numeric = parseMillis(value);
		if (numeric !== undefined) return numeric;
	}
	for (const key of ['reset_in', 'resetIn', 'ttl', 'window']) {
		const seconds = toNumber(data[key]);
		if (seconds !== undefined) return nowMs + seconds * 1000;
	}
	return undefined;
}

function buildKimiWindow(windowData: Record<string, unknown>, nowMs: number): UsageWindow | undefined {
	const duration = toNumber(windowData.duration);
	const timeUnit = typeof windowData.timeUnit === 'string' ? windowData.timeUnit : '';
	const label = duration !== undefined && timeUnit ? durationLabel(duration, timeUnit) : undefined;
	const resetsAt = parseResetTime(windowData, nowMs);
	if (duration === undefined && !label && resetsAt === undefined) return undefined;
	let durationMs: number | undefined;
	if (duration !== undefined) {
		const upper = timeUnit.toUpperCase();
		if (upper.includes('MINUTE')) durationMs = duration * 60_000;
		else if (upper.includes('HOUR')) durationMs = duration * HOUR_MS;
		else if (upper.includes('DAY')) durationMs = duration * DAY_MS;
		else if (upper.includes('SECOND')) durationMs = duration * 1000;
	}
	return { id: label ?? 'window', label: label ?? 'Usage window', ...(durationMs !== undefined ? { durationMs } : {}), ...(resetsAt !== undefined ? { resetsAt } : {}) };
}

function buildKimiLimit(provider: string, row: Record<string, unknown>, label: string, index: number, window: UsageWindow | undefined, accountId?: string): UsageLimit | null {
	const used = toNumber(row.used) ?? toNumber(row.current) ?? toNumber(row.currentValue) ?? toNumber(row.usage);
	const limit = toNumber(row.limit) ?? toNumber(row.total) ?? toNumber(row.quota);
	const remaining = toNumber(row.remaining) ?? toNumber(row.left) ?? toNumber(row.available);
	if (used === undefined && limit === undefined && remaining === undefined) return null;
	const inferredUsed = used ?? (limit !== undefined && remaining !== undefined ? limit - remaining : undefined);
	const amount = amountFromValues({ used: inferredUsed, limit, remaining, unit: 'tokens' });
	return {
		id: `${provider}:${index}`,
		label,
		scope: { provider, accountId, windowId: window?.id, shared: true },
		...(window ? { window } : {}),
		amount,
		status: liveStatusFor(amount.usedFraction),
	};
}

function parseKimiUsagePayload(provider: string, payload: unknown, nowMs: number, accountId?: string): UsageLimit[] {
	if (!isRecord(payload)) return [];
	const limits: UsageLimit[] = [];
	if (isRecord(payload.usage)) {
		const limit = buildKimiLimit(provider, payload.usage, 'Total quota', limits.length, undefined, accountId);
		if (limit) limits.push(limit);
	}
	if (Array.isArray(payload.limits)) {
		payload.limits.forEach((item) => {
			if (!isRecord(item)) return;
			const detail = isRecord(item.detail) ? item.detail : item;
			const windowData = isRecord(item.window) ? item.window : {};
			const label = typeof item.name === 'string' && item.name
				? item.name
				: typeof item.title === 'string' && item.title
					? item.title
					: typeof item.scope === 'string' && item.scope
						? item.scope
						: typeof detail.name === 'string' && detail.name
							? detail.name
							: durationLabel(toNumber(windowData.duration) ?? 0, String(windowData.timeUnit || '')) ?? `Limit #${limits.length + 1}`;
			const limit = buildKimiLimit(provider, detail, label, limits.length, buildKimiWindow(windowData, nowMs), accountId);
			if (limit) limits.push(limit);
		});
	}
	return limits;
}

function kimiHeaders(): Record<string, string> {
	return { 'User-Agent': 'SpectraCode/0.5', 'X-Msh-Platform': 'spectra_code', 'X-Msh-Version': '0.5' };
}

const kimiUsageProvider: UsageProvider = {
	id: 'kimi-code',
	supports(provider, credential) {
		return (provider === 'kimi-code' || provider === 'kimi-coding-plan') && credential?.type === 'oauth';
	},
	async fetchUsage({ provider, credential, baseUrl, nowMs, signal, fetchImpl }) {
		if (credential.type !== 'oauth' || credential.expires <= nowMs) return null;
		const url = `${normalizeBaseUrl(baseUrl)}/usages`;
		const response = await fetchImpl(url, { headers: { ...kimiHeaders(), Authorization: `Bearer ${credential.access}` }, signal });
		if (!response.ok) return null;
		const raw = await response.json();
		const limits = parseKimiUsagePayload(provider, raw, nowMs, credential.accountId);
		if (limits.length === 0) return null;
		return { provider, fetchedAt: nowMs, limits, metadata: { endpoint: url, accountId: credential.accountId }, raw };
	},
};

function formatCountedUnit(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function buildZaiWindow(raw: Record<string, unknown>): UsageWindow {
	const count = Math.max(1, toNumber(raw.number) ?? 1);
	const unit = toNumber(raw.unit);
	if (unit === 3) return { id: `${count}h`, label: formatCountedUnit(count, 'Hour'), durationMs: count * HOUR_MS, ...(parseMillis(raw.nextResetTime) !== undefined ? { resetsAt: parseMillis(raw.nextResetTime) } : {}) };
	if (unit === 4) return { id: `${count}d`, label: formatCountedUnit(count, 'Day'), durationMs: count * DAY_MS, ...(parseMillis(raw.nextResetTime) !== undefined ? { resetsAt: parseMillis(raw.nextResetTime) } : {}) };
	if (unit === 5) return { id: `${count}mo`, label: count === 1 ? 'Monthly' : formatCountedUnit(count, 'Month'), durationMs: count * MONTH_MS, ...(parseMillis(raw.nextResetTime) !== undefined ? { resetsAt: parseMillis(raw.nextResetTime) } : {}) };
	if (unit === 6) return { id: '1w', label: 'Weekly', durationMs: WEEK_MS, ...(parseMillis(raw.nextResetTime) !== undefined ? { resetsAt: parseMillis(raw.nextResetTime) } : {}) };
	return { id: unit !== undefined ? `${count}u${unit}` : 'quota', label: 'Quota', ...(parseMillis(raw.nextResetTime) !== undefined ? { resetsAt: parseMillis(raw.nextResetTime) } : {}) };
}

function requestQuotaLabel(raw: Record<string, unknown>): string {
	const details = Array.isArray(raw.usageDetails) ? raw.usageDetails : [];
	const codes = details.filter(isRecord).map((detail) => detail.modelCode).filter((code): code is string => typeof code === 'string');
	if (codes.includes('search-prime') && codes.includes('web-reader') && codes.includes('zread')) return 'ZAI Web Search / Reader / Zread Quota';
	return 'ZAI Request Quota';
}

function parseZaiLimits(provider: string, payload: unknown): UsageLimit[] {
	if (!isRecord(payload) || payload.success !== true || !isRecord(payload.data) || !Array.isArray(payload.data.limits)) return [];
	const limits: UsageLimit[] = [];
	for (const raw of payload.data.limits) {
		if (!isRecord(raw) || typeof raw.type !== 'string') continue;
		const window = buildZaiWindow(raw);
		if (raw.type === 'TOKENS_LIMIT') {
			const amount = amountFromValues({ used: toNumber(raw.currentValue), limit: toNumber(raw.usage), remaining: toNumber(raw.remaining), percentage: toNumber(raw.percentage), unit: 'tokens' });
			limits.push({ id: `${provider}:tokens:${window.id}`, label: `ZAI ${window.label} Token Quota`, scope: { provider, windowId: window.id, shared: true }, window, amount, status: liveStatusFor(amount.usedFraction) });
		}
		if (raw.type === 'TIME_LIMIT') {
			const amount = amountFromValues({ used: toNumber(raw.currentValue), limit: toNumber(raw.usage), remaining: toNumber(raw.remaining), percentage: toNumber(raw.percentage), unit: 'requests' });
			limits.push({ id: `${provider}:requests:${window.id}`, label: requestQuotaLabel(raw), scope: { provider, windowId: window.id, shared: true }, window, amount, status: liveStatusFor(amount.usedFraction) });
		}
	}
	return limits;
}

function zaiOrigin(baseUrl: string): string {
	try {
		return new URL(baseUrl).origin;
	} catch {
		return 'https://api.z.ai';
	}
}

const zaiUsageProvider: UsageProvider = {
	id: 'zai',
	supports(provider, credential) {
		return (provider === 'zai-coding-plan' || provider === 'zhipuai-coding-plan' || provider === 'zhipu-coding-plan') && credential?.type === 'api';
	},
	async fetchUsage({ provider, credential, baseUrl, nowMs, signal, fetchImpl }) {
		if (credential.type !== 'api') return null;
		const endpoint = `${zaiOrigin(baseUrl)}/api/monitor/usage/quota/limit`;
		const response = await fetchImpl(endpoint, { headers: { Authorization: `Bearer ${credential.key}` }, signal });
		if (!response.ok) return null;
		const raw = await response.json();
		const limits = parseZaiLimits(provider, raw);
		if (limits.length === 0) return null;
		return { provider, fetchedAt: nowMs, limits, metadata: { endpoint }, raw };
	},
};

function parseJwtPayload(token: string): Record<string, unknown> | null {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
	} catch {
		return null;
	}
}

function extractCodexAccountId(token: string): string | undefined {
	const payload = parseJwtPayload(token);
	const auth = payload?.['https://api.openai.com/auth'];
	return isRecord(auth) && typeof auth.chatgpt_account_id === 'string' ? auth.chatgpt_account_id : undefined;
}

function extractCodexEmail(token: string): string | undefined {
	const payload = parseJwtPayload(token);
	const profile = payload?.['https://api.openai.com/profile'];
	return isRecord(profile) && typeof profile.email === 'string' ? profile.email.toLowerCase() : undefined;
}

function codexWindowLabel(seconds: number): { id: string; label: string } {
	if (seconds >= DAY_MS / 1000) {
		const days = Math.max(1, Math.round(seconds / (DAY_MS / 1000)));
		return { id: `${days}d`, label: days === 1 ? '1 Day' : `${days} Days` };
	}
	const hours = Math.max(1, Math.round(seconds / 3600));
	return { id: `${hours}h`, label: hours === 1 ? '1 Hour' : `${hours} Hours` };
}

function buildCodexLimit(provider: string, key: 'primary' | 'secondary', windowPayload: Record<string, unknown>, limitReached: boolean | undefined, accountId?: string, planType?: string, nowMs = Date.now()): UsageLimit {
	const seconds = toNumber(windowPayload.limit_window_seconds);
	const label = seconds !== undefined ? codexWindowLabel(seconds) : { id: key, label: key === 'primary' ? 'Primary window' : 'Secondary window' };
	const resetAtRaw = toNumber(windowPayload.reset_at);
	const resetAfter = toNumber(windowPayload.reset_after_seconds);
	const resetsAt = resetAtRaw !== undefined ? parseMillis(resetAtRaw) : resetAfter !== undefined ? nowMs + resetAfter * 1000 : undefined;
	const usedPercent = toNumber(windowPayload.used_percent);
	const amount = amountFromValues({ used: usedPercent, limit: 100, remaining: usedPercent === undefined ? undefined : 100 - usedPercent, unit: 'percent' });
	return {
		id: `${provider}:${key}`,
		label: label.label,
		scope: { provider, accountId, tier: planType, windowId: label.id, shared: true },
		window: { id: label.id, label: label.label, ...(seconds !== undefined ? { durationMs: seconds * 1000 } : {}), ...(resetsAt !== undefined ? { resetsAt } : {}) },
		amount,
		status: limitReached ? 'exhausted' : liveStatusFor(amount.usedFraction),
	};
}

const codexUsageProvider: UsageProvider = {
	id: 'openai-codex',
	supports(provider, credential) {
		return provider === 'openai-codex' && credential?.type === 'oauth';
	},
	async fetchUsage({ provider, credential, baseUrl, nowMs, signal, fetchImpl }) {
		if (credential.type !== 'oauth' || credential.expires <= nowMs) return null;
		const base = normalizeBaseUrl(baseUrl || 'https://chatgpt.com/backend-api');
		const url = `${base}/wham/usage`;
		const accountId = credential.accountId ?? extractCodexAccountId(credential.access);
		const headers: Record<string, string> = { Authorization: `Bearer ${credential.access}`, 'User-Agent': 'SpectraCode/0.5' };
		if (accountId) headers['ChatGPT-Account-Id'] = accountId;
		const response = await fetchImpl(url, { headers, signal });
		if (!response.ok) return null;
		const raw = await response.json();
		if (!isRecord(raw) || !isRecord(raw.rate_limit)) return null;
		const limits: UsageLimit[] = [];
		const rateLimit = raw.rate_limit;
		const limitReached = rateLimit.limit_reached === true;
		const planType = typeof raw.plan_type === 'string' ? raw.plan_type : undefined;
		if (isRecord(rateLimit.primary_window)) limits.push(buildCodexLimit(provider, 'primary', rateLimit.primary_window, limitReached, accountId, planType, nowMs));
		if (isRecord(rateLimit.secondary_window)) limits.push(buildCodexLimit(provider, 'secondary', rateLimit.secondary_window, limitReached, accountId, planType, nowMs));
		if (limits.length === 0) return null;
		return { provider, fetchedAt: nowMs, limits, metadata: { endpoint: url, accountId, email: extractCodexEmail(credential.access), planType }, raw };
	},
};

const USAGE_PROVIDERS: UsageProvider[] = [kimiUsageProvider, zaiUsageProvider, codexUsageProvider];

async function refreshedCredential(provider: string, credential: Credential | undefined, nowMs: number, signal?: AbortSignal): Promise<Credential | undefined> {
	if (!credential) return undefined;
	if ((provider === 'kimi-code' || provider === 'kimi-coding-plan') && credential.type === 'oauth' && credential.expires <= nowMs + KIMI_REFRESH_SKEW_MS) {
		try {
			const refreshed = await refreshKimiCode(credential.refresh, signal);
			const next = { ...refreshed, accountId: credential.accountId ?? refreshed.accountId };
			writeCredential(provider, next);
			return next;
		} catch {
			return credential;
		}
	}
	if (provider === 'openai-codex' && credential.type === 'oauth' && credential.expires <= nowMs + KIMI_REFRESH_SKEW_MS) {
		try {
			const refreshed = await refreshCodexToken(credential.refresh, signal);
			const next = { ...refreshed, accountId: credential.accountId ?? refreshed.accountId };
			writeCredential(provider, next);
			return next;
		} catch {
			return credential;
		}
	}
	if (provider === 'xai' && credential.type === 'oauth' && credential.refresh && credential.expires <= nowMs + KIMI_REFRESH_SKEW_MS) {
		try {
			const refreshed = await refreshXaiToken(credential.refresh, signal);
			const next = { ...refreshed, accountId: credential.accountId ?? refreshed.accountId };
			writeCredential(provider, next);
			return next;
		} catch {
			return credential;
		}
	}
	if (provider === 'github-copilot' && credential.type === 'oauth' && credential.refresh && credential.expires <= nowMs + KIMI_REFRESH_SKEW_MS) {
		try {
			const refreshed = await refreshGitHubCopilotToken(credential.refresh, signal);
			const next = { ...refreshed, accountId: credential.accountId ?? refreshed.accountId };
			writeCredential(provider, next);
			return next;
		} catch {
			return credential;
		}
	}
	if (provider === 'snowflake-cortex' && credential.type === 'oauth' && credential.refresh && credential.accountId && credential.expires <= nowMs + KIMI_REFRESH_SKEW_MS) {
		try {
			const refreshed = await refreshSnowflakeCortexToken(credential.accountId, credential.refresh, signal);
			const next = { ...refreshed, accountId: credential.accountId ?? refreshed.accountId };
			writeCredential(provider, next);
			return next;
		} catch {
			return credential;
		}
	}
	return credential;
}

async function fetchLiveUsageReport(provider: string, credential: Credential | undefined, options: Required<Pick<FetchUsageReportsOptions, 'nowMs' | 'fetchImpl'>> & Pick<FetchUsageReportsOptions, 'signal'>): Promise<UsageReport | null> {
	const providerImpl = USAGE_PROVIDERS.find((candidate) => candidate.supports(provider, credential));
	if (!providerImpl || !credential) return null;
	return providerImpl.fetchUsage({ provider, credential, baseUrl: providerBaseUrl(provider), nowMs: options.nowMs, signal: options.signal, fetchImpl: options.fetchImpl });
}

export async function fetchUsageReports(options: FetchUsageReportsOptions = {}): Promise<ProviderUsageReport[]> {
	const nowMs = options.nowMs ?? Date.now();
	const fetchImpl = options.fetchImpl ?? fetch;
	const auth = readAll();
	const entries = readUsageEntries(options.dataDir);
	const cache = readUsageCache(options.dataDir);
	let cacheChanged = false;
	const providerSet = new Set([...(options.providers ?? []), ...Object.keys(auth), ...entries.map((entry) => entry.provider)]);
	if (providerSet.size === 0) providerSet.add('opencode-go');

	const reports: ProviderUsageReport[] = [];
	for (const provider of [...providerSet].sort((a, b) => a.localeCompare(b))) {
		const credential = await refreshedCredential(provider, auth[provider], nowMs, options.signal);
		const cached = cache[provider];
		if (cached && nowMs - cached.fetchedAt < USAGE_CACHE_TTL_MS) {
			reports.push(reportFromLiveUsage(cached, entries));
			continue;
		}
		try {
			const live = await fetchLiveUsageReport(provider, credential, { nowMs, fetchImpl, signal: options.signal });
			if (live) {
				cache[provider] = live;
				cacheChanged = true;
				reports.push(reportFromLiveUsage(live, entries));
				continue;
			}
		} catch {
			// Per-provider failures fall through to last-good or observed local usage.
		}
		if (cached) {
			reports.push({ ...reportFromLiveUsage(cached, entries), notes: [...(cached.notes ?? []), 'Last live snapshot shown; refresh failed.'] });
			continue;
		}
		const baseReport = buildProviderUsageReport(provider, entries, nowMs);
		const note = credential ? 'Live usage endpoint unavailable for this provider/account.' : 'No credential connected for live usage.';
		reports.push({ ...baseReport, notes: [...baseReport.notes, note] });
	}
	if (cacheChanged) writeUsageCache(cache, options.dataDir);
	return reports.filter((report) => report.provider in CODING_PLAN_LIMITS || report.entries > 0 || report.source === 'live');
}
