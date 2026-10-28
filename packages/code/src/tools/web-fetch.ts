import { z } from 'zod';
import type { SpectraTool } from './types.js';
import { errorResult, textResult } from './utils.js';
import { APP_USER_AGENT } from '../services/app-version.js';
import { SsrfGuard } from '../security/ssrf-guard.js';
import { safeFetch } from './network.js';

export function createWebFetchTool(guard: SsrfGuard = new SsrfGuard()): SpectraTool {
	return {
		name: 'web_fetch',
		capabilities: { reads: false, writes: false },
		description: `Fetch content from a URL and return it as markdown text.
Useful for reading documentation, API responses, or any web content.
Handles HTML to markdown conversion, JSON formatting, and byte-capped responses.`,
		displayName: (args: { url: string }) => {
			try {
				return new URL(args.url).hostname;
			} catch {
				return args.url;
			}
		},
		parameters: z.object({
			url: z.string().describe('The URL to fetch content from'),
			maxLength: z.number().optional().describe('Maximum characters to return'),
		}),
		execute: async ({ url, maxLength }) => {
			try {
				new URL(url);
			} catch {
				return errorResult(`Invalid URL: ${url}`);
			}

			const result = await safeFetch(url, guard, {
				headers: { 'User-Agent': APP_USER_AGENT },
				timeoutMs: 15_000,
				maxBytes: 2 * 1024 * 1024,
			});
			if (!result.ok) return errorResult(result.error);

			const response = result.response;
			if (response.status < 200 || response.status >= 300) {
				return errorResult(`HTTP ${response.status}: ${response.statusText}`);
			}

			let content: string;
			if (response.contentType.includes('text/html')) {
				content = htmlToMarkdown(response.text);
			} else if (response.contentType.includes('application/json')) {
				try {
					content = JSON.stringify(JSON.parse(response.text), null, 2);
				} catch {
					content = response.text;
				}
			} else {
				content = response.text;
			}
			if (response.truncated) content += '\n...(response truncated)';

			const limit = maxLength || 10000;
			if (content.length > limit) {
				content = content.slice(0, limit) + '\n...(truncated)';
			}

			return textResult(content);
		},
	};
}

export const webFetchTool = createWebFetchTool();

function htmlToMarkdown(html: string): string {
	let text = html
		.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
		.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
		.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
		.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
		.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
		.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
		.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
		.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
		.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>/gi, '\n\n')
		.replace(/<[^>]+>/g, '')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();

	return text;
}
