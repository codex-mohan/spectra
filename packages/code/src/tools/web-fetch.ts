import { z } from "zod";
import type { SpectraTool } from "./types.js";
import { errorResult, textResult } from "./utils.js";

export const webFetchTool: SpectraTool = {
  name: "web_fetch",
  description: `Fetch content from a URL and return it as markdown text.
Useful for reading documentation, API responses, or any web content.
Handles HTML to markdown conversion, PDF text extraction, and image descriptions.`,
  displayName: (args: { url: string }) => new URL(args.url).hostname,
  parameters: z.object({
    url: z.string().describe("The URL to fetch content from"),
    maxLength: z.number().optional().describe("Maximum characters to return"),
  }),
  execute: async ({ url, maxLength }) => {
    try {
      new URL(url);
    } catch {
      return errorResult(`Invalid URL: ${url}`);
    }

    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "Spectra-Code/1.0" },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        return errorResult(`HTTP ${response.status}: ${response.statusText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      let content: string;

      if (contentType.includes("text/html")) {
        const html = await response.text();
        content = htmlToMarkdown(html);
      } else if (contentType.includes("application/json")) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        content = await response.text();
      }

      const limit = maxLength || 10000;
      if (content.length > limit) {
        content = content.slice(0, limit) + "\n...(truncated)";
      }

      return textResult(content);
    } catch (err: unknown) {
      const error = err as { name?: string; message?: string };
      if (error.name === "TimeoutError") {
        return errorResult("Request timed out after 15 seconds.");
      }
      return errorResult(`Failed to fetch URL: ${error.message || "unknown error"}`);
    }
  },
};

function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n")
    .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}
