// ---------------------------------------------------------------------------
// Template command types — pure TypeScript, no React/OpenTUI imports.
// ---------------------------------------------------------------------------

/** Supported context providers declared in template frontmatter. */
export type ContextProviderKind = 'git.status' | 'git.diff';

/** Parsed frontmatter from a template .md file. */
export interface TemplateFrontmatter {
	readonly description: string;
	readonly contextProviders: readonly ContextProviderKind[];
}

/** Structured diagnostic from template loading, parsing, or rendering. */
export interface TemplateDiagnostic {
	/** Category of issue. */
	readonly kind: 'parse' | 'validation' | 'load';
	/** Absolute path of the problematic file. */
	readonly sourcePath: string;
	/** Human-readable message including provider/source details when applicable. */
	readonly message: string;
}

/** A parsed template before conversion to CommandDefinition. */
export interface TemplateDefinition {
	/** Path-derived name, normalized to `/`, without `.md` extension. */
	readonly name: string;
	/** Required description from frontmatter. */
	readonly description: string;
	/** Absolute path to the .md file. */
	readonly sourcePath: string;
	/** Template body (everything after frontmatter). */
	readonly content: string;
	/** Declared context providers from frontmatter. */
	readonly contextProviders: readonly ContextProviderKind[];
}
