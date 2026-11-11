import { existsSync } from 'fs';
import { dirname, extname, join, resolve } from 'path';
import { homedir } from 'os';
import type { LspConfig, LspLinterConfig, LspServerConfig } from '../services/config.js';
import { hasRootMarker } from './executable.js';

export interface ResolvedLspSettings {
	enabled: boolean;
	requestTimeout: number;
	diagnosticsOnWrite: boolean;
	shared: boolean;
	formatOnWrite: boolean;
	diagnostics: { waitMs: number; pull: boolean };
	settings: Record<string, unknown>;
	linters: { biome: LspLinterConfig };
	servers: Record<string, LspServerConfig>;
}

// Server definitions and routing conventions reference oh-my-pi's built-in
// LSP catalog (MIT, https://github.com/can1357/oh-my-pi). No source is copied;
// entries are standard server commands and root markers.
const DEFAULT_SERVERS: Record<string, LspServerConfig> = {
	typescript: {
		command: 'typescript-language-server',
		args: ['--stdio'],
		filetypes: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
		rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
		languageId: 'typescript',
	},
	deno: {
		command: 'deno',
		args: ['lsp'],
		filetypes: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
		rootMarkers: ['deno.json', 'deno.jsonc', 'deno.lock'],
		languageId: 'typescript',
	},
	python: {
		command: 'pyright-langserver',
		args: ['--stdio'],
		filetypes: ['.py', '.pyi'],
		rootMarkers: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt'],
		languageId: 'python',
	},
	basedpyright: {
		command: 'basedpyright-langserver',
		args: ['--stdio'],
		filetypes: ['.py', '.pyi'],
		rootMarkers: ['pyproject.toml', 'pyrightconfig.json', 'setup.py', 'requirements.txt'],
		languageId: 'python',
	},
	ty: {
		command: 'ty',
		args: ['server'],
		filetypes: ['.py', '.pyi'],
		rootMarkers: ['pyproject.toml', 'ty.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'],
		languageId: 'python',
	},
	ruff: {
		command: 'ruff',
		args: ['server'],
		filetypes: ['.py', '.pyi'],
		rootMarkers: ['pyproject.toml', 'ruff.toml', '.ruff.toml'],
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
	bash: {
		command: 'bash-language-server',
		args: ['start'],
		filetypes: ['.sh', '.bash', '.zsh'],
		rootMarkers: ['.git'],
		languageId: 'shellscript',
	},
	lua: {
		command: 'lua-language-server',
		args: [],
		filetypes: ['.lua'],
		rootMarkers: ['.luarc.json', '.luarc.jsonc', '.luacheckrc', 'stylua.toml', '.git'],
		languageId: 'lua',
	},
	dockerfile: {
		command: 'docker-langserver',
		args: ['--stdio'],
		filetypes: ['Dockerfile', '.dockerfile'],
		rootMarkers: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml', '.dockerignore'],
		languageId: 'dockerfile',
	},
	terraform: {
		command: 'terraform-ls',
		args: ['serve'],
		filetypes: ['.tf', '.tfvars'],
		rootMarkers: ['.terraform', '*.tfstate', '*.tf'],
		languageId: 'terraform',
	},
	kotlin: {
		command: 'kotlin-lsp',
		args: ['--stdio'],
		filetypes: ['.kt', '.kts'],
		rootMarkers: ['build.gradle', 'build.gradle.kts', 'pom.xml', 'settings.gradle', 'settings.gradle.kts'],
		languageId: 'kotlin',
	},
	swift: {
		command: 'sourcekit-lsp',
		args: [],
		filetypes: ['.swift'],
		rootMarkers: ['Package.swift', '*.xcodeproj', '*.xcworkspace', 'project.yml', '.swiftpm'],
		languageId: 'swift',
	},
	dart: {
		command: 'dart',
		args: ['language-server', '--protocol=lsp'],
		filetypes: ['.dart'],
		rootMarkers: ['pubspec.yaml', 'pubspec.lock'],
		languageId: 'dart',
	},
	nix: {
		command: 'nixd',
		args: [],
		filetypes: ['.nix'],
		rootMarkers: ['flake.nix', 'default.nix', 'shell.nix'],
		languageId: 'nix',
	},
	elixir: {
		command: 'elixir-ls',
		args: [],
		filetypes: ['.ex', '.exs', '.heex', '.eex'],
		rootMarkers: ['mix.exs', 'mix.lock'],
		languageId: 'elixir',
	},
	haskell: {
		command: 'haskell-language-server-wrapper',
		args: ['--lsp'],
		filetypes: ['.hs', '.lhs'],
		rootMarkers: ['stack.yaml', 'cabal.project', 'hie.yaml', 'package.yaml', '*.cabal'],
		languageId: 'haskell',
	},
	ocaml: {
		command: 'ocamllsp',
		args: [],
		filetypes: ['.ml', '.mli', '.mll', '.mly'],
		rootMarkers: ['dune-project', 'dune-workspace', '*.opam', '.ocamlformat'],
		languageId: 'ocaml',
	},
	scala: {
		command: 'metals',
		args: [],
		filetypes: ['.scala', '.sbt', '.sc'],
		rootMarkers: ['build.sbt', 'build.sc', 'build.gradle', 'pom.xml'],
		languageId: 'scala',
	},
	prisma: {
		command: 'prisma-language-server',
		args: ['--stdio'],
		filetypes: ['.prisma'],
		rootMarkers: ['schema.prisma', 'prisma/schema.prisma'],
		languageId: 'prisma',
	},
	graphql: {
		command: 'graphql-lsp',
		args: ['server', '-m', 'stream'],
		filetypes: ['.graphql', '.gql'],
		rootMarkers: ['.graphqlrc', '.graphqlrc.json', '.graphqlrc.yml', '.graphqlrc.yaml', 'graphql.config.js'],
		languageId: 'graphql',
	},
	vue: {
		command: 'vue-language-server',
		args: ['--stdio'],
		filetypes: ['.vue'],
		rootMarkers: ['vue.config.js', 'nuxt.config.js', 'nuxt.config.ts', 'package.json'],
		languageId: 'vue',
	},
	svelte: {
		command: 'svelteserver',
		args: ['--stdio'],
		filetypes: ['.svelte'],
		rootMarkers: ['svelte.config.js', 'svelte.config.mjs', 'package.json'],
		languageId: 'svelte',
	},
	astro: {
		command: 'astro-ls',
		args: ['--stdio'],
		filetypes: ['.astro'],
		rootMarkers: ['astro.config.mjs', 'astro.config.js', 'astro.config.ts'],
		languageId: 'astro',
	},
	tailwindcss: {
		command: 'tailwindcss-language-server',
		args: ['--stdio'],
		filetypes: ['.html', '.css', '.scss', '.js', '.jsx', '.ts', '.tsx', '.vue', '.svelte'],
		rootMarkers: ['tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs', 'tailwind.config.cjs'],
		languageId: 'tailwindcss',
	},
	markdown: {
		command: 'marksman',
		args: ['server'],
		filetypes: ['.md', '.markdown'],
		rootMarkers: ['.marksman.toml', '.git'],
		languageId: 'markdown',
	},
	zig: {
		command: 'zls',
		args: [],
		filetypes: ['.zig'],
		rootMarkers: ['build.zig', 'build.zig.zon', 'zls.json'],
		languageId: 'zig',
	},
	clojure: {
		command: 'clojure-lsp',
		args: [],
		filetypes: ['.clj', '.cljs', '.cljc', '.edn'],
		rootMarkers: ['deps.edn', 'project.clj', 'shadow-cljs.edn', 'bb.edn', '.clj-kondo'],
		languageId: 'clojure',
	},
	erlang: {
		command: 'erlang_ls',
		args: [],
		filetypes: ['.erl', '.hrl'],
		rootMarkers: ['rebar.config', 'rebar.lock', 'erlang.mk', 'mix.exs'],
		languageId: 'erlang',
	},
	gleam: {
		command: 'gleam',
		args: ['lsp'],
		filetypes: ['.gleam'],
		rootMarkers: ['gleam.toml'],
		languageId: 'gleam',
	},
	taplo: {
		command: 'taplo',
		args: ['lsp', 'stdio'],
		filetypes: ['.toml'],
		rootMarkers: ['taplo.toml', '.taplo.toml', 'Cargo.toml', 'pyproject.toml'],
		languageId: 'toml',
	},
	sql: {
		command: 'sqls',
		args: [],
		filetypes: ['.sql'],
		rootMarkers: ['sqls.yml', '.sqls.yml', '.git'],
		languageId: 'sql',
	},
	texlab: {
		command: 'texlab',
		args: [],
		filetypes: ['.tex', '.bib', '.sty', '.cls'],
		rootMarkers: ['.latexmkrc', 'latexmkrc', '.texlabroot', 'texlabroot', 'Tectonic.toml'],
		languageId: 'latex',
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
		},
		settings: config?.settings ?? {},
		linters: { biome: config?.linters?.biome ?? {} },
		servers: { ...DEFAULT_SERVERS, ...(config?.servers ?? {}) },
	};
}

export function findServersForFile(
	file: string,
	servers: Record<string, LspServerConfig>,
): Array<{ id: string; server: LspServerConfig }> {
	const extension = extname(file).toLowerCase();
	const base = file.split(/[\\/]/).pop()?.toLowerCase() ?? '';
	return Object.entries(servers)
		.filter(([, server]) => (server.filetypes ?? []).some(
			(type) => type.toLowerCase() === extension || type.toLowerCase() === base,
		))
		.map(([id, server]) => ({ id, server }));
}

export function findServerForFile(
	file: string,
	servers: Record<string, LspServerConfig>,
): { id: string; server: LspServerConfig } | null {
	return findServersForFile(file, servers)[0] ?? null;
}

/** Whether any ancestor of `file` contains one of the server's root markers. */
export function workspaceRootMatches(file: string, markers: string[]): boolean {
	const home = resolve(homedir());
	let current = resolve(dirname(file));
	for (;;) {
		if (hasRootMarker(current, markers)) return true;
		if (current === home) return false;
		const parent = dirname(current);
		if (parent === current) return false;
		current = parent;
	}
}

export function findWorkspaceRoot(file: string, markers: string[]): string {
	const home = resolve(homedir());
	let current = resolve(dirname(file));
	for (;;) {
		if (hasRootMarker(current, markers)) return current;
		if (current === home) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return resolve(dirname(file));
}
