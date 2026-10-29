export interface Position { line: number; character: number }
export interface Range { start: Position; end: Position }
export interface Location { uri: string; range: Range }
export interface LocationLink { targetUri: string; targetRange: Range; targetSelectionRange?: Range }
export interface TextEdit { range: Range; newText: string }
export interface WorkspaceEdit {
	changes?: Record<string, TextEdit[]>;
	documentChanges?: Array<{ textDocument: { uri: string; version?: number | null }; edits: TextEdit[] }>;
}
export interface Diagnostic {
	range: Range;
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
	relatedInformation?: unknown[];
}
export interface PublishDiagnosticsParams { uri: string; version?: number; diagnostics: Diagnostic[] }
export interface DocumentSymbol {
	name: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}
export interface SymbolInformation { name: string; kind: number; location: Location; containerName?: string }
export interface Hover { contents: unknown; range?: Range }
export interface CodeAction {
	title: string;
	kind?: string;
	edit?: WorkspaceEdit;
	command?: { title: string; command: string; arguments?: unknown[] };
}
export interface ServerCapabilities {
	diagnosticProvider?: { interFileDependencies?: boolean; workspaceDiagnostics?: boolean } | boolean;
	textDocumentSync?: number | { openClose?: boolean; change?: number; save?: boolean | { includeText?: boolean } };
	positionEncoding?: string;
	[key: string]: unknown;
}
export interface WorkspaceFolder { uri: string; name: string }
