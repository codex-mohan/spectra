import type { ToolResult } from "@singularity-ai/spectra-agent";

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  outputBytes: number;
  maxLines: number;
  maxBytes: number;
  truncatedBy: "lines" | "bytes";
  firstLineExceedsLimit: boolean;
  lastLinePartial: boolean;
}

export interface BashToolDetails {
  truncation?: TruncationResult;
  fullOutputPath?: string;
  exitCode: number | null;
  durationMs?: number;
}

export interface ReadToolDetails {
  truncation?: TruncationResult;
  totalLines: number;
  startLine: number;
  endLine: number;
}

export interface EditToolDetails {
  diff: string;
  firstChangedLine?: number;
}

export interface GrepToolDetails {
  truncation?: TruncationResult;
  matchCount: number;
}

export interface FindToolDetails {
  truncation?: TruncationResult;
  totalFiles: number;
}

export interface LsToolDetails {
  truncation?: TruncationResult;
  totalEntries: number;
}

export interface WebFetchToolDetails {
  url: string;
  status: number;
  contentType: string;
  contentLength: number;
  truncated: boolean;
}

export interface Edit {
  oldText: string;
  newText: string;
}

export interface BashOperations {
  exec(
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: Record<string, string | undefined>;
    },
  ): Promise<{ exitCode: number | null }>;
}

export interface BashToolOptions {
  operations?: BashOperations;
  commandPrefix?: string;
}

export interface ReadOperations {
  readFile(absolutePath: string): Promise<Buffer>;
  access(absolutePath: string): Promise<void>;
  detectImageMimeType?(absolutePath: string): Promise<string | null | undefined>;
}

export interface ReadToolOptions {
  operations?: ReadOperations;
}

export interface EditOperations {
  readFile(absolutePath: string): Promise<Buffer>;
  writeFile(absolutePath: string, content: string): Promise<void>;
  access(absolutePath: string): Promise<void>;
}

export interface EditToolOptions {
  operations?: EditOperations;
}

export interface WriteOperations {
  writeFile(absolutePath: string, content: string): Promise<void>;
  mkdir(dir: string): Promise<void>;
}

export interface WriteToolOptions {
  operations?: WriteOperations;
}

export interface GrepOperations {
  spawn(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal },
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface GrepToolOptions {
  operations?: GrepOperations;
}

export interface FindOperations {
  spawn(
    args: string[],
    cwd: string,
    options: { signal?: AbortSignal },
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string }>;
}

export interface FindToolOptions {
  operations?: FindOperations;
}

export interface WebFetchOperations {
  fetch(url: string, options: { signal?: AbortSignal; timeout?: number }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface WebFetchToolOptions {
  operations?: WebFetchOperations;
  maxLength?: number;
}

export type ToolResultWithDetails<T> = ToolResult<T>;