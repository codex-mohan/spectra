import { z } from "zod";
import { defineTool } from "@singularity-ai/spectra-agent";
import { truncateTail } from "../utils/truncate.js";

export interface WebFetchOperations {
  fetch(url: string, options: { signal?: AbortSignal; timeout?: number }): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

const defaultFetchOperations: WebFetchOperations = {
  fetch: async (url, { signal, timeout }) => {
    const controller = new AbortController();
    const timeoutId = timeout ? setTimeout(() => controller.abort(), timeout * 1000) : undefined;

    if (signal) {
      signal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "Spectra-Code/1.0" },
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key] = value; });

      const body = await response.text();
      return { status: response.status, headers, body };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  },
};

export interface WebFetchToolDetails {
  url: string;
  status: number;
  contentType: string;
  contentLength: number;
  truncated: boolean;
}

export interface WebFetchToolOptions {
  operations?: WebFetchOperations;
  maxLength?: number;
}

export const createWebFetchTool = (options?: WebFetchToolOptions) => {
  const ops = options?.operations ?? defaultFetchOperations;
  const maxLength = options?.maxLength ?? 50000;

  return defineTool({
    name: "web_fetch",
    label: "Web Fetch",
    description: "Fetch content from a URL. Returns the response body as text. Useful for retrieving web pages, API responses, or other online content. The response is truncated if it exceeds the maximum length.",
    promptGuidelines: [
      "Use web_fetch to retrieve information from URLs when you need current data from the internet.",
      "For web pages, the response will include HTML which you should parse mentally to extract relevant content.",
      "Prefer web_fetch over asking the user to copy-paste web content.",
    ],
    parameters: z.object({
      url: z.string().describe("The URL to fetch content from"),
      timeout: z.number().optional().describe("Timeout in seconds (default: 30)"),
    }),
    execute: async (args, { signal }) => {
      if (signal?.aborted) throw new Error("Operation aborted");

      const timeout = args.timeout ?? 30;
      const startTime = Date.now();

      try {
        const result = await ops.fetch(args.url, { signal, timeout });
        const contentType = result.headers["content-type"] ?? "unknown";
        const durationMs = Date.now() - startTime;

        let body = result.body;
        const truncated = body.length > maxLength;
        if (truncated) {
          body = body.slice(0, maxLength);
        }

        const details: WebFetchToolDetails = {
          url: args.url,
          status: result.status,
          contentType,
          contentLength: result.body.length,
          truncated,
        };

        if (result.status >= 400) {
          return {
            content: [{ type: "text" as const, text: `HTTP ${result.status} from ${args.url}\n\n${body}` }],
            details,
            isError: true,
          };
        }

        let output = body;
        if (truncated) {
          output += `\n\n[Content truncated at ${maxLength} bytes. Total size: ${result.body.length} bytes]`;
        }
        output += `\n\n[HTTP ${result.status} | ${contentType} | ${durationMs}ms]`;

        return { content: [{ type: "text" as const, text: output }], details };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("abort")) {
          return {
            content: [{ type: "text" as const, text: `Request to ${args.url} was aborted` }],
            details: { url: args.url, status: 0, contentType: "", contentLength: 0, truncated: false },
            isError: true,
          };
        }
        throw err;
      }
    },
  });
};