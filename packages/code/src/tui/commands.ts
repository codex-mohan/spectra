import type { CmdItem } from './components/command-palette.js';
import type { SessionStore } from '../services/session-store.js';
import { getEffortLabel } from './variant-cycle.js';
import { titlecase } from './utils.js';
import { calculateCost, formatCost, formatTokens, isFreeModel } from '@mohanscodex/spectra-ai';
import { lookupContextWindow } from './utils/model-config.js';
import { showToast } from './components/toast.js';

export function buildCmdItems(opts: {
	renderer: { destroy: () => void };
	sessionStore: SessionStore;
	hasModel: boolean;
	selectedModel: string | null;
	provider: string | null;
	mcpCount: number;
	customProviderCount: number;
	messagesLength: number;
	showThinking: boolean;
	showToolCalls: boolean;
	setRoute: (r: 'home' | 'chat') => void;
	setMessages: (fn: (prev: any[]) => any[]) => void;
	setStatus: (s: string) => void;
	setElapsedMs: (v: null) => void;
	setTokPerSec: (v: null) => void;
	setTokenUsage: (v: { input: number; output: number }) => void;
	setShowThinking: (fn: (v: boolean) => boolean) => void;
	setShowToolCalls: (fn: (v: boolean) => boolean) => void;
	setHomeKey: (fn: (k: number) => number) => void;
	setNavKey: (fn: (k: number) => number) => void;
	setDialogStep: (
		v:
			| { type: 'provider' }
			| { type: 'session-list'; mode?: 'delete' | 'rename' }
			| { type: 'switch-model' }
			| { type: 'manage-providers' }
			| { type: 'doctor'; result: any }
			| { type: 'about' }
			| { type: 'switch-agent' }
			| { type: 'thinking-effort' }
			| { type: 'toggle-mcp' }
			| { type: 'debug' }
			| { type: 'cost' }
			| { type: 'theme' }
			| { type: 'permissions' }
			| { type: 'settings' }
			| null,
	) => void;
	sessionIdRef: { current: string | null };
	onCycleVariant: () => void;
	currentEffort?: string;
	selectedAgent: string;
	onSecurityReset?: () => void;
	tokenUsage?: { input: number; output: number };
	elapsedMs?: number | null;
	tokPerSec?: number | null;
	turnCount?: number;
}): CmdItem[] {
	const {
		renderer,
		sessionStore: s,
		sessionIdRef,
		hasModel,
		selectedModel,
		provider,
		mcpCount,
		customProviderCount,
		messagesLength,
		showThinking,
		showToolCalls,
		setRoute,
		setMessages,
		setStatus,
		setElapsedMs,
		setTokPerSec,
		setTokenUsage,
		setShowThinking,
		setShowToolCalls,
		setHomeKey,
		setNavKey,
		setDialogStep,
		currentEffort,
		selectedAgent,
		onSecurityReset,
		tokenUsage,
		elapsedMs,
		tokPerSec,
		turnCount,
	} = opts;
	return [
		// Session
		{
			id: 'new',
			label: 'New Session',
			desc: 'Start fresh',
			cat: 'Session',
			slashName: 'new',
			slashAliases: ['clear'],
			action: () => {
				sessionIdRef.current = null;
				setMessages(() => []);
				setRoute('home');
				setHomeKey((k) => k + 1);
				setNavKey((k) => k + 1);
				setStatus('New session');
				setTimeout(() => setStatus('Ready'), 3000);
				onSecurityReset?.();
			},
		},
		{
			id: 'sessions',
			label: 'List Sessions',
			desc: 'Browse saved sessions',
			cat: 'Session',
			slashName: 'sessions',
			slashAliases: ['resume', 'continue'],
			action: () => {
				setDialogStep({ type: 'session-list' });
			},
		},
		{
			id: 'delete-session',
			label: 'Delete Session',
			desc: 'Remove a saved session',
			cat: 'Session',
			slashName: 'delete-session',
			action: () => {
				setDialogStep({ type: 'session-list', mode: 'delete' });
			},
		},
		{
			id: 'rename-session',
			label: 'Rename Session',
			desc: 'Change session title',
			cat: 'Session',
			slashName: 'rename',
			action: () => {
				setDialogStep({ type: 'session-list', mode: 'rename' });
			},
		},
		{
			id: 'fork-session',
			label: 'Fork Session',
			desc: 'Copy session to new one',
			cat: 'Session',
			slashName: 'fork',
			action: () => {
				const sid = opts.sessionIdRef.current;
				if (!sid) {
					setStatus('No active session');
					return;
				}
				const forked = s.fork(sid);
				if (forked) {
					sessionIdRef.current = forked.id;
					opts.sessionIdRef.current = forked.id;
					setStatus(`Forked: ${forked.title}`);
				}
			},
		},
		{
			id: 'archive-session',
			label: 'Archive Session',
			desc: 'Move session to archive',
			cat: 'Session',
			slashName: 'archive',
			action: () => {
				const sid = opts.sessionIdRef.current;
				if (!sid) {
					setStatus('No active session');
					return;
				}
				s.archive(sid);
				sessionIdRef.current = null;
				opts.sessionIdRef.current = null;
				setMessages(() => []);
				setRoute('home');
				opts.setHomeKey?.((k: number) => k + 1);
				setStatus('Session archived');
			},
		},
		{
			id: 'clear',
			label: 'Clear',
			desc: 'Clear conversation',
			cat: 'Session',
			slashName: 'clear',
			action: () => {
				setMessages(() => []);
				setStatus('Cleared');
			},
		},
		// Display
		{
			id: 'toggle-thinking',
			label: `${showThinking ? 'Hide' : 'Show'} Thinking`,
			desc: showThinking ? 'Hide thinking blocks' : 'Show thinking blocks',
			cat: 'Display',
			slashName: 'thinking',
			slashAliases: ['toggle-thinking'],
			action: () => {
				setShowThinking((v) => !v);
			},
		},
		{
			id: 'toggle-tools',
			label: `${showToolCalls ? 'Hide' : 'Show'} Tool Calls`,
			desc: showToolCalls ? 'Hide tool call indicators' : 'Show tool call indicators',
			cat: 'Display',
			slashName: 'tools',
			slashAliases: ['toggle-tools'],
			action: () => {
				setShowToolCalls((v) => !v);
			},
		},
		// Provider
		{
			id: 'provider',
			label: 'Connect Provider',
			desc: hasModel ? 'Switch API provider' : 'No provider configured',
			cat: 'Provider',
			slashName: 'connect',
			slashAliases: ['provider'],
			action: () => {
				setDialogStep({ type: 'provider' });
			},
		},
		{
			id: 'manage-providers',
			label: 'Manage Providers',
			desc: `${opts.customProviderCount} custom provider${opts.customProviderCount !== 1 ? 's' : ''}`,
			cat: 'Provider',
			slashName: 'providers',
			action: () => {
				setDialogStep({ type: 'manage-providers' });
			},
		},
		// Model
		{
			id: 'switch-model',
			label: 'Switch Model',
			desc: selectedModel || 'No model selected',
			cat: 'Agent',
			slashName: 'model',
			slashAliases: ['models', 'switch-model'],
			action: () => {
				setDialogStep({ type: 'switch-model' });
			},
		},
		{
			id: 'switch-agent',
			label: 'Switch Agent',
			desc: titlecase(selectedAgent || 'build'),
			cat: 'Agent',
			slashName: 'agent',
			slashAliases: ['agents', 'switch-agent'],
			action: () => {
				setDialogStep({ type: 'switch-agent' });
			},
		},
		{
			id: 'cycle-effort',
			label: 'Thinking effort cycle',
			desc: `effort: ${getEffortLabel(currentEffort)}`,
			cat: 'Agent',
			slashName: 'effort',
			slashAliases: ['cycle-effort', 'variant'],
			action: () => {
				opts.onCycleVariant();
			},
		},
		{
			id: 'change-effort',
			label: 'Change Thinking effort',
			desc: `set to ${getEffortLabel(currentEffort)}`,
			cat: 'Agent',
			slashName: 'thinking-effort',
			slashAliases: ['change-effort'],
			action: () => {
				setDialogStep({ type: 'thinking-effort' });
			},
		},
		{
			id: 'toggle-mcp',
			label: 'Toggle MCPs',
			desc: `${opts.mcpCount} connected`,
			cat: 'Agent',
			slashName: 'mcp',
			slashAliases: ['toggle-mcp'],
			action: () => {
				setDialogStep({ type: 'toggle-mcp' });
			},
		},
		// Navigation
		{
			id: 'home',
			label: 'Go Home',
			desc: 'Return to home',
			cat: 'Navigation',
			slashName: 'home',
			action: () => {
				setRoute('home');
			},
		},
		// System
		{
			id: 'doctor',
			label: 'Doctor',
			desc: 'Run health check',
			cat: 'System',
			slashName: 'doctor',
			action: () => {
				setDialogStep({ type: 'doctor', result: null } as any);
				import('../commands/doctor.js').then((m) =>
					m.runDoctor().then((result: any) => {
						setDialogStep({ type: 'doctor', result } as any);
					}),
				);
			},
		},
		{
			id: 'debug',
			label: 'Debug',
			desc: 'System information',
			cat: 'System',
			slashName: 'debug',
			action: () => {
				setDialogStep({ type: 'debug' });
			},
		},
		{
			id: 'about',
			label: 'About',
			desc: 'Version info',
			cat: 'System',
			slashName: 'about',
			action: () => {
				setDialogStep({ type: 'about' });
			},
		},
		{
			id: 'help',
			label: 'Help',
			desc: 'Keyboard shortcuts',
			cat: 'System',
			slashName: 'help',
			action: () => {
				setStatus('Esc quit · Tab agents · Ctrl+P palette · Ctrl+L clear');
				setTimeout(() => setStatus('Ready'), 4000);
			},
		},
		{
			id: 'quit',
			label: 'Quit',
			desc: 'Exit',
			cat: 'System',
			slashName: 'exit',
			slashAliases: ['quit', 'q'],
			action: () => renderer.destroy(),
		},
		// Observability
		{
			id: 'cost',
			label: 'Show Cost',
			desc: 'Estimated session cost',
			cat: 'Observability',
			slashName: 'cost',
			action: () => {
				setDialogStep({ type: 'cost' });
			},
		},
		{
			id: 'tokens',
			label: 'Show Tokens',
			desc: 'Token usage breakdown',
			cat: 'Observability',
			slashName: 'tokens',
			action: () => {
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				const total = input + output;
				if (total === 0) {
					setStatus('No token usage yet');
					setTimeout(() => setStatus('Ready'), 3000);
					return;
				}
				const ctxMax = selectedModel ? lookupContextWindow(selectedModel, provider) : null;
				const pct = ctxMax ? Math.round((total / ctxMax) * 100) : null;
				const ctxStr = pct != null ? ` · ${pct}% of ${formatTokens(ctxMax!)} ctx` : '';
				setStatus(`↑${formatTokens(input)} input · ↓${formatTokens(output)} output${ctxStr}`);
				setTimeout(() => setStatus('Ready'), 5000);
			},
		},
		{
			id: 'stats',
			label: 'Show Stats',
			desc: 'Session statistics',
			cat: 'Observability',
			slashName: 'stats',
			action: () => {
				const parts: string[] = [];
				if (selectedModel) parts.push(`Model: ${selectedModel}`);
				if (provider) parts.push(`Provider: ${provider}`);
				if (turnCount != null) parts.push(`Turns: ${turnCount}`);
				if (messagesLength > 0) parts.push(`Messages: ${messagesLength}`);
				if (elapsedMs != null) {
					const sec = (elapsedMs / 1000).toFixed(1);
					parts.push(`Duration: ${sec}s`);
				}
				if (tokPerSec != null && tokPerSec > 0) {
					parts.push(`${tokPerSec.toFixed(1)} tok/s`);
				}
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				if (input + output > 0) {
					if (selectedModel && !isFreeModel(selectedModel)) {
						const cost = calculateCost(selectedModel, { input, output });
						parts.push(`Cost: ${formatCost(cost.total)}`);
					}
					parts.push(`Tokens: ↑${formatTokens(input)} ↓${formatTokens(output)}`);
				}
				setStatus(parts.join(' · ') || 'No stats available');
				setTimeout(() => setStatus('Ready'), 5000);
			},
		},
		{
			id: 'context',
			label: 'Show Context',
			desc: 'Context window usage',
			cat: 'Observability',
			slashName: 'context',
			action: () => {
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				const total = input + output;
				if (total === 0) {
					setStatus('No token usage yet');
					setTimeout(() => setStatus('Ready'), 3000);
					return;
				}
				if (!selectedModel) {
					setStatus(`Tokens used: ${formatTokens(total)}`);
					setTimeout(() => setStatus('Ready'), 3000);
					return;
				}
				const ctxMax = lookupContextWindow(selectedModel, provider);
				if (!ctxMax) {
					setStatus(`Tokens used: ${formatTokens(total)} (context window unknown for ${selectedModel})`);
					setTimeout(() => setStatus('Ready'), 3000);
					return;
				}
				const remaining = Math.max(0, ctxMax - total);
				const pct = Math.round((total / ctxMax) * 100);
				const bar = pct > 90 ? '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10)) : '';
				setStatus(`${formatTokens(total)} / ${formatTokens(ctxMax)} (${pct}%) · ${formatTokens(remaining)} remaining${bar ? ' ' + bar : ''}`);
				setTimeout(() => setStatus('Ready'), 5000);
			},
		},
		{
			id: 'status',
			label: 'Status',
			desc: 'System status',
			cat: 'Observability',
			slashName: 'status',
			action: () => {
				const parts: string[] = [];
				if (selectedModel) parts.push(`Model: ${selectedModel}`);
				if (provider) parts.push(`Provider: ${provider}`);
				if (mcpCount > 0) parts.push(`MCPs: ${mcpCount}`);
				if (selectedAgent) parts.push(`Agent: ${selectedAgent}`);
				const input = tokenUsage?.input ?? 0;
				const output = tokenUsage?.output ?? 0;
				if (input + output > 0) {
					parts.push(`Tokens: ↑${formatTokens(input)} ↓${formatTokens(output)}`);
					if (selectedModel && !isFreeModel(selectedModel)) {
						const cost = calculateCost(selectedModel, { input, output });
						parts.push(`Cost: ${formatCost(cost.total)}`);
					}
				}
				setStatus(parts.join(' · ') || 'No model selected');
				setTimeout(() => setStatus('Ready'), 5000);
			},
		},
		// Session
		{
			id: 'save',
			label: 'Save Session',
			desc: 'Explicitly save current session',
			cat: 'Session',
			slashName: 'save',
			action: () => {
				const sid = sessionIdRef.current;
				if (!sid) {
					showToast('No active session to save', 'warn');
					return;
				}
				showToast('Session saved', 'success');
			},
		},
		{
			id: 'search',
			label: 'Search Sessions',
			desc: 'Search sessions by query',
			cat: 'Session',
			slashName: 'search',
			action: () => {
				setDialogStep({ type: 'session-list' });
			},
		},
		{
			id: 'export',
			label: 'Export Session',
			desc: 'Export session to JSON/Markdown',
			cat: 'Session',
			slashName: 'export',
			action: () => {
				const sid = sessionIdRef.current;
				if (!sid) {
					showToast('No active session to export', 'warn');
					return;
				}
				showToast('Export feature coming soon', 'info');
			},
		},
		{
			id: 'history',
			label: 'Show History',
			desc: 'Conversation turn history',
			cat: 'Session',
			slashName: 'history',
			action: () => {
				if (messagesLength === 0) {
					showToast('No conversation history', 'warn');
					return;
				}
				showToast(`${messagesLength} messages in conversation`, 'info');
			},
		},
		{
			id: 'compress',
			label: 'Compress Context',
			desc: 'Manually trigger context compaction',
			cat: 'Session',
			slashName: 'compress',
			action: () => {
				showToast('Context compaction coming soon', 'info');
			},
		},
		// Git
		{
			id: 'commit',
			label: 'Commit Changes',
			desc: 'Stage and commit with AI message',
			cat: 'Git',
			slashName: 'commit',
			action: () => {
				showToast('AI commit feature coming soon', 'info');
			},
		},
		{
			id: 'review',
			label: 'Review Changes',
			desc: 'Review uncommitted changes',
			cat: 'Git',
			slashName: 'review',
			action: () => {
				showToast('Review feature coming soon', 'info');
			},
		},
		// Config
		{
			id: 'theme',
			label: 'Switch Theme',
			desc: 'Change color theme',
			cat: 'Config',
			slashName: 'theme',
			action: () => {
				setDialogStep({ type: 'theme' });
			},
		},
		{
			id: 'permissions',
			label: 'Permissions',
			desc: 'View/edit tool permissions',
			cat: 'Config',
			slashName: 'permissions',
			action: () => {
				setDialogStep({ type: 'permissions' });
			},
		},
		{
			id: 'settings',
			label: 'Settings',
			desc: 'Open settings panel',
			cat: 'Config',
			slashName: 'settings',
			action: () => {
				setDialogStep({ type: 'settings' });
			},
		},
	];
}

export function collectSlashNames(items: CmdItem[]): Set<string> {
	const names = new Set<string>();
	for (const item of items) {
		if (item.slashName) names.add(item.slashName);
		if (item.slashAliases) {
			for (const alias of item.slashAliases) names.add(alias);
		}
	}
	return names;
}
