import type { ToolResult } from '@mohanscodex/spectra-agent';
import { ArtifactStore } from '../internal-urls/artifact-store.js';

/** Tools that already bound their own output and must not be re-truncated. */
const EXEMPT_TOOLS = new Set(['read', 'grep', 'glob']);

const HEAD_CHARS = 40_000;
const TAIL_CHARS = 40_000;

export interface OutputGuardOptions {
	/** Byte threshold above which the full body is spilled and the result trimmed. */
	truncateBytes: number;
	artifactDir: string;
	/** Injectable for tests; defaults to the filesystem artifact store. */
	putArtifact?: (body: string, extension: string) => Promise<string>;
}

export interface OutputGuardResult {
	result: ToolResult;
	bytes: number;
	truncated: boolean;
	artifactId?: string;
}

function textContent(result: ToolResult): string {
	return result.content
		.filter((part): part is Extract<ToolResult['content'][number], { type: 'text' }> => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
	return `${Math.round(bytes / 1024)} KiB`;
}

/**
 * Spill oversized tool output to an artifact and replace the inline body with a
 * head/tail preview. The full body is always written before trimming, so the
 * model can recover it through `artifact://<id>`.
 */
export async function guardToolOutput(
	toolName: string,
	result: ToolResult,
	options: OutputGuardOptions,
): Promise<OutputGuardResult> {
	const body = textContent(result);
	const bytes = Buffer.byteLength(body, 'utf8');
	if (EXEMPT_TOOLS.has(toolName) || options.truncateBytes <= 0 || bytes < options.truncateBytes) {
		return { result, bytes, truncated: false };
	}

	const put = options.putArtifact ?? ((content: string, extension: string) =>
		new ArtifactStore(options.artifactDir).put(content, extension));
	const artifactId = await put(body, 'txt');
	const head = body.slice(0, HEAD_CHARS);
	const tail = body.slice(-TAIL_CHARS);
	const marker = `[Output truncated: ${formatBytes(bytes)} total; full output at artifact://${artifactId}]`;
	const replacement = `${head}\n\n...${marker}...\n\n${tail}`;
	const nonText = result.content.filter((part) => part.type !== 'text');
	const details = result.details && typeof result.details === 'object'
		? { ...(result.details as Record<string, unknown>), outputGuard: { bytes, truncated: true, artifactId } }
		: { outputGuard: { bytes, truncated: true, artifactId } };

	return {
		result: {
			...result,
			content: [{ type: 'text', text: replacement }, ...nonText],
			details,
		},
		bytes,
		truncated: true,
		artifactId,
	};
}
