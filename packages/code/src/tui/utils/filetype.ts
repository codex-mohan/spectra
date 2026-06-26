/**
 * Maps file extensions to tree-sitter language identifiers.
 * Used by <code> and <diff> components for syntax highlighting.
 */

const EXT_TO_LANG: Record<string, string> = {
	// TypeScript/JavaScript
	ts: 'typescript',
	tsx: 'typescript',
	js: 'javascript',
	jsx: 'javascript',
	mjs: 'javascript',
	cjs: 'javascript',
	mts: 'typescript',
	cts: 'typescript',

	// Web
	html: 'html',
	htm: 'html',
	css: 'css',
	scss: 'scss',
	sass: 'scss',
	less: 'css',
	vue: 'vue',
	svelte: 'svelte',

	// Systems
	rs: 'rust',
	go: 'go',
	c: 'c',
	h: 'c',
	cpp: 'cpp',
	cc: 'cpp',
	cxx: 'cpp',
	hpp: 'cpp',
	cs: 'c_sharp',
	swift: 'swift',
	kt: 'kotlin',
	kts: 'kotlin',
	zig: 'zig',
	nim: 'nim',
	v: 'v',
	d: 'd',

	// JVM
	java: 'java',
	scala: 'scala',
	clj: 'clojure',
	groovy: 'groovy',

	// Scripting
	py: 'python',
	rbx: 'lua',
	rb: 'ruby',
	pl: 'perl',
	pm: 'perl',
	php: 'php',
	ex: 'elixir',
	exs: 'elixir',
	erl: 'erlang',
	hs: 'haskell',
	lua: 'lua',
	r: 'r',
	R: 'r',

	// Shell
	sh: 'bash',
	bash: 'bash',
	zsh: 'bash',
	fish: 'fish',
	ps1: 'powershell',

	// Data
	json: 'json',
	jsonc: 'json',
	json5: 'json',
	yaml: 'yaml',
	yml: 'yaml',
	toml: 'toml',
	xml: 'xml',
	ini: 'ini',
	properties: 'properties',

	// Markup
	md: 'markdown',
	markdown: 'markdown',
	mdx: 'markdown',
	rst: 'rst',
	latex: 'latex',
	tex: 'latex',

	// Query/Config
	sql: 'sql',
	graphql: 'graphql',
	gql: 'graphql',
	proto: 'protobuf',
	tf: 'hcl',
	hcl: 'hcl',

	// Build/CI
	dockerfile: 'dockerfile',
	makefile: 'makefile',
	cmake: 'cmake',
	gradle: 'groovy',

	// Other
	graphqls: 'graphql',
	vim: 'vim',
	ml: 'ocaml',
	asm: 'asm',
	s: 'asm',
};

/**
 * Get the tree-sitter language identifier for a file path.
 * Returns undefined if the extension is not recognized.
 */
export function filetype(filePath?: string): string | undefined {
	if (!filePath) return undefined;
	const ext = filePath.split('.').pop()?.toLowerCase();
	if (!ext) return undefined;
	return EXT_TO_LANG[ext];
}
