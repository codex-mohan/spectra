import { existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { homedir } from 'os';
import type { LspConfig, LspLinterConfig, LspServerConfig } from '../services/config.js';

export interface ResolvedLspSettings {
	enabled: boolean;
	requestTimeout: number;
	diagnosticsOnWrite: boolean;
	shared: boolean;
	formatOnWrite: boolean;
	diagnostics: { waitMs: number; pull: boolean; workspaceConcurrency: number };
	settings: Record<string, unknown>;
	linters: { biome: LspLinterConfig };
	servers: Record<string, LspServerConfig>;
}

const DEFAULT_SERVERS: Record<string, LspServerConfig> = {
	typescript: {
		command: 'typescript-language-server',
		args: ['--stdio'],
		filetypes: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
		rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
		languageId: 'typescript',
	},
	python: {
		command: 'pyright-langserver',
		args: ['--stdio'],
		filetypes: ['.py', '.pyi'],
		rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
		languageId: 'python',
	},
	rust: {
		command: 'rust-analyzer',
		args: [],
		filetypes: ['.rs'],
		rootMarkers: ['Cargo.toml'],
		languageId: 'rust',
	},
	go: {
		command: 'gopls',
		args: [],
		filetypes: ['.go'],
		rootMarkers: ['go.mod'],
		languageId: 'go',
	},
	c: {
		command: 'clangd',
		args: [],
		filetypes: ['.c', '.h'],
		rootMarkers: ['compile_commands.json', 'CMakeLists.txt', 'Makefile'],
		languageId: 'c',
	},
	cpp: {
		command: 'clangd',
		args: [],
		filetypes: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
		rootMarkers: ['compile_commands.json', 'CMakeLists.txt', 'Makefile'],
		languageId: 'cpp',
	},
	java: {
		command: 'jdtls',
		args: [],
		filetypes: ['.java'],
		rootMarkers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'],
		languageId: 'java',
	},
	csharp: {
		command: 'omnisharp',
		args: ['-lsp'],
		filetypes: ['.cs'],
		rootMarkers: ['.sln', '.csproj'],
		languageId: 'csharp',
	},
	ruby: {
		command: 'solargraph',
		args: ['stdio'],
		filetypes: ['.rb', '.rake', 'Gemfile'],
		rootMarkers: ['Gemfile', '.ruby-version'],
		languageId: 'ruby',
	},
	php: {
		command: 'intelephense',
		args: ['--stdio'],
		filetypes: ['.php'],
		rootMarkers: ['composer.json'],
		languageId: 'php',
	},
	css: {
		command: 'vscode-css-language-server',
		args: ['--stdio'],
		filetypes: ['.css', '.scss', '.less'],
		rootMarkers: ['package.json'],
		languageId: 'css',
	},
	html: {
		command: 'vscode-html-language-server',
		args: ['--stdio'],
		filetypes: ['.html', '.htm'],
		rootMarkers: ['package.json'],
		languageId: 'html',
	},
	json: {
		command: 'vscode-json-language-server',
		args: ['--stdio'],
		filetypes: ['.json', '.jsonc'],
		rootMarkers: ['package.json'],
		languageId: 'json',
	},
	yaml: {
		command: 'yaml-language-server',
		args: ['--stdio'],
		filetypes: ['.yaml', '.yml'],
		rootMarkers: ['.git', 'package.json'],
		languageId: 'yaml',
	},
};

export function resolveLspSettings(config?: LspConfig): ResolvedLspSettings {
	return {
		enabled: config?.enabled ?? true,
		requestTimeout: Math.min(300_000, Math.max(1_000, config?.requestTimeout ?? 20_000)),
		diagnosticsOnWrite: config?.diagnosticsOnWrite ?? true,
		shared: config?.shared ?? true,
		formatOnWrite: config?.formatOnWrite ?? false,
		diagnostics: {
			waitMs: Math.min(10_000, Math.max(0, config?.diagnostics?.waitMs ?? 1500)),
			pull: config?.diagnostics?.pull ?? true,
			workspaceConcurrency: Math.min(8, Math.max(1, config?.diagnostics?.workspaceConcurrency ?? 4)),
		},
		settings: config?.settings ?? {},
		linters: { biome: config?.linters?.biome ?? {} },
		servers: { ...DEFAULT_SERVERS, ...(config?.servers ?? {}) },
	};
}

export function findServerForFile(
	file: string,
	servers: Record<string, LspServerConfig>,
): { id: string; server: LspServerConfig } | null {
	const extension = extname(file).toLowerCase();
	const base = file.split(/[\\/]/).pop()?.toLowerCase() ?? '';
	for (const [id, server] of Object.entries(servers)) {
		const filetypes = server.filetypes ?? [];
		if (filetypes.some((type) => type.toLowerCase() === extension || type.toLowerCase() === base)) {
			return { id, server };
		}
	}
	return null;
}

export function findWorkspaceRoot(file: string, markers: string[]): string {
	const home = resolve(homedir());
	let current = resolve(dirname(file));
	for (;;) {
		if (markers.some((marker) => existsSync(join(current, marker)))) return current;
		if (current === home) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return resolve(dirname(file));
}
