import { execFileSync } from 'child_process';
import { accessSync, constants, existsSync, statSync } from 'fs';
import { getGlobalConfigDir, getGlobalDataDir, getGlobalCacheDir } from '../utils/paths.js';
import { getPlatformInfo } from '../utils/platform.js';
import { loadConfig, type SpectraConfig } from '../services/config.js';
import { readAll, type Credential } from '../services/auth-store.js';
import { isCredentialConnected } from '../services/provider-connection.js';

export type DoctorCheckStatus = 'pass' | 'warning' | 'error';

export interface DoctorResult {
	checks: DoctorCheck[];
	allPassed: boolean;
	hasWarnings: boolean;
}

export interface DoctorCheck {
	section: string;
	name: string;
	passed: boolean;
	status: DoctorCheckStatus;
	detail: string;
}

export interface ProviderReadiness {
	providerId: string | null;
	modelSelected: boolean;
	credentialConnected: boolean;
}

const LOCAL_NO_AUTH_PROVIDERS = new Set(['ollama', 'lm-studio', 'llama-cpp', 'vllm', 'sglang']);
const ENV_KEYS_BY_PROVIDER: Readonly<Record<string, readonly string[]>> = {
	anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_KEY'],
	openai: ['OPENAI_API_KEY'],
	openrouter: ['OPENROUTER_API_KEY'],
	groq: ['GROQ_API_KEY'],
	azure: ['AZURE_OPENAI_API_KEY'],
	cerebras: ['CEREBRAS_API_KEY'],
	xai: ['XAI_API_KEY'],
};

function canonicalProviderId(providerId: string): string {
	return providerId === 'openai-completions' || providerId === 'openai-responses' ? 'openai' : providerId;
}

function hasEnvironmentCredential(providerId: string | null, env: NodeJS.ProcessEnv): boolean {
	if (!providerId) {
		return Object.values(ENV_KEYS_BY_PROVIDER).some((keys) => keys.some((key) => Boolean(env[key])));
	}
	return (ENV_KEYS_BY_PROVIDER[canonicalProviderId(providerId)] ?? []).some((key) => Boolean(env[key]));
}

export function getProviderReadiness(
	config: SpectraConfig,
	credentials: Record<string, Credential>,
	now = Date.now(),
	env: NodeJS.ProcessEnv = process.env,
): ProviderReadiness {
	const providerId = config.provider ?? config.model?.split('/')[0] ?? null;
	const credentialId = providerId ? canonicalProviderId(providerId) : null;
	const customProvider = providerId ? config.providers?.[providerId] : undefined;
	const storedCredential = credentialId ? credentials[credentialId] ?? credentials[providerId ?? ''] : undefined;
	const selectedProviderConnected = providerId !== null && (
		LOCAL_NO_AUTH_PROVIDERS.has(providerId) ||
		isCredentialConnected(storedCredential, customProvider, now) ||
		hasEnvironmentCredential(providerId, env)
	);
	const anyStoredCredential = Object.entries(credentials).some(([id, credential]) =>
		LOCAL_NO_AUTH_PROVIDERS.has(id) || isCredentialConnected(credential, config.providers?.[id], now),
	);
	const anyCustomCredential = Object.values(config.providers ?? {}).some(
		(provider) => provider.enabled !== false && Boolean(provider.apiKey),
	);

	return {
		providerId,
		modelSelected: Boolean(config.model),
		credentialConnected: selectedProviderConnected || (!providerId && (
			anyStoredCredential || anyCustomCredential || hasEnvironmentCredential(null, env)
		)),
	};
}

export async function runDoctor(): Promise<DoctorResult> {
	const checks: DoctorCheck[] = [];

	function add(section: string, name: string, status: DoctorCheckStatus, detail: string): void {
		checks.push({ section, name, status, passed: status === 'pass', detail });
	}

	function tryExec(command: string, args: string[]): string {
		try {
			return execFileSync(command, args, {
				encoding: 'utf-8',
				timeout: 2000,
				windowsHide: true,
				stdio: ['ignore', 'pipe', 'ignore'],
			}).trim();
		} catch {
			return '';
		}
	}

	function checkDirectory(name: string, path: string): void {
		try {
			if (!existsSync(path)) {
				add('directories', name, 'pass', `${path} (created on first use)`);
				return;
			}
			if (!statSync(path).isDirectory()) {
				add('directories', name, 'error', `${path} exists but is not a directory`);
				return;
			}
			accessSync(path, constants.R_OK | constants.W_OK);
			add('directories', name, 'pass', path);
		} catch (error) {
			add('directories', name, 'error', `${path}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	const info = getPlatformInfo();
	add('system', 'Platform', 'pass', `${info.os} (${info.arch})`);

	const configuredShell = info.shell;
	const powerShell = /^(pwsh|powershell)(\.exe)?$/i.test(configuredShell) ? configuredShell : 'powershell.exe';
	const shellCommand = process.platform === 'win32' ? powerShell : configuredShell;
	const shellArgs = process.platform === 'win32'
		? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']
		: ['--version'];
	const shellVersion = tryExec(shellCommand, shellArgs);
	add(
		'system',
		'Shell',
		shellVersion ? 'pass' : 'error',
		shellVersion ? `${shellCommand}: ${shellVersion.split('\n')[0]}` : `${shellCommand} could not be executed`,
	);

	const bunVersion = process.versions.bun;
	add(
		'system',
		'Bun runtime',
		bunVersion ? 'pass' : 'error',
		bunVersion ? `Bun ${bunVersion}` : `Bun is required; current runtime is ${process.version}`,
	);

	const cwd = process.cwd();
	add('system', 'Working directory', existsSync(cwd) ? 'pass' : 'error', cwd);

	const config = loadConfig(cwd);
	const hasConfig = Object.keys(config).length > 0;
	add(
		'config',
		'Configuration',
		'pass',
		hasConfig
			? `model: ${config.model || '(not selected)'}  provider: ${config.provider || '(auto)'}`
			: 'No config file; built-in defaults are available',
	);

	const readiness = getProviderReadiness(config, readAll());
	add(
		'config',
		'Model selection',
		readiness.modelSelected ? 'pass' : 'warning',
		readiness.modelSelected ? config.model ?? '' : 'Select a model before sending prompts',
	);
	add(
		'config',
		'Provider authentication',
		readiness.credentialConnected ? 'pass' : 'warning',
		readiness.credentialConnected
			? readiness.providerId ? `Connected: ${readiness.providerId}` : 'Stored provider credentials found'
			: readiness.providerId
				? `Connect ${readiness.providerId} or configure its API key`
				: 'Connect a provider before sending prompts',
	);

	const rgVersion = tryExec(process.platform === 'win32' ? 'rg.exe' : 'rg', ['--version']);
	add(
		'tools',
		'ripgrep',
		rgVersion ? 'pass' : 'error',
		rgVersion ? rgVersion.split('\n')[0] : 'Required by the grep and glob tools; install rg or add it to PATH',
	);

	const gitVersion = tryExec('git', ['--version']);
	add(
		'tools',
		'git',
		gitVersion ? 'pass' : 'warning',
		gitVersion || 'Unavailable; snapshots, revert, and Git context are disabled',
	);

	checkDirectory('Config dir', getGlobalConfigDir());
	checkDirectory('Data dir', getGlobalDataDir());
	checkDirectory('Cache dir', getGlobalCacheDir());

	try {
		const { listProviders } = await import('@mohanscodex/spectra-ai');
		const providers = listProviders();
		add(
			'providers',
			'Provider registry',
			providers.length > 0 ? 'pass' : 'error',
			providers.length > 0 ? providers.join(', ') : 'No providers registered',
		);
	} catch (error) {
		add('providers', 'Provider registry', 'error', error instanceof Error ? error.message : 'Failed to load');
	}

	const term = process.env.TERM || process.env.TERMINAL;
	add('terminal', 'Interactive terminal', process.stdout.isTTY ? 'pass' : 'warning', process.stdout.isTTY ? 'TTY available' : 'stdout is not a TTY');
	add('terminal', 'TERM', term ? 'pass' : 'warning', term || 'Not set');
	const hasSize = Boolean(process.stdout.columns && process.stdout.rows);
	add('terminal', 'Size', hasSize ? 'pass' : 'warning', `${process.stdout.columns || '?'}x${process.stdout.rows || '?'}`);

	return {
		checks,
		allPassed: !checks.some((check) => check.status === 'error'),
		hasWarnings: checks.some((check) => check.status === 'warning'),
	};
}
