# RAG Agent

An agent that reads files to answer questions from local documents.

## What It Does

The agent reads files from the filesystem to answer questions based on local documents — a simple RAG (Retrieval-Augmented Generation) pattern.

## Prerequisites

```bash
bun add @singularity-ai/spectra-ai @singularity-ai/spectra-agent
export ANTHROPIC_API_KEY=sk-ant-...
```

## Full Code

```typescript
import { Agent, defineTool } from "@singularity-ai/spectra-agent";
import { z } from "zod";
import { readFile, readdir } from "fs/promises";
import { join, extname } from "path";

const MAX_FILE_SIZE = 10000;

const fileReaderTool = defineTool({
  name: "read_file",
  description: "Read the content of a file. Use when the user asks about the content of a specific file or wants to search within documents.",
  parameters: z.object({
    path: z.string().describe("The file path to read"),
  }),
  execute: async ({ path }) => {
    try {
      const content = await readFile(path, "utf-8");
      const truncated = content.length > MAX_FILE_SIZE
        ? content.slice(0, MAX_FILE_SIZE) + "\n\n[... file truncated, be more specific]"
        : content;
      return { content: [{ type: "text", text: truncated }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error reading ${path}: ${error.message}` }], isError: true };
    }
  },
});

const listFilesTool = defineTool({
  name: "list_files",
  description: "List files in a directory. Use to discover what files are available before reading them.",
  parameters: z.object({
    path: z.string().describe("The directory path to list"),
  }),
  execute: async ({ path }) => {
    try {
      const files = await readdir(path);
      return { content: [{ type: "text", text: files.join("\n") }] };
    } catch (error: any) {
      return { content: [{ type: "text", text: `Error listing ${path}: ${error.message}` }], isError: true };
    }
  },
});

const agent = new Agent({
  model: {
    id: "claude-sonnet-4-20250514",
    name: "Claude Sonnet 4",
    provider: "anthropic",
    api: "anthropic-messages",
  },
  systemPrompt: "You are a document assistant. Use list_files to discover available files, then read_file to read their content. Answer questions based on the file content.",
  tools: [listFilesTool, fileReaderTool],
});

for await (const event of agent.run("What files are in ./docs? Summarize the README.")) {
  if (event.type === "message_update") {
    const text = event.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
    process.stdout.write(text);
  }
}
console.log();
```

## How It Works

1. User asks about files
2. Agent calls `list_files` to discover what's available
3. Agent calls `read_file` to read specific files
4. Agent synthesizes an answer from the file content

## Customization

- Add PDF parsing with `pdf-parse`
- Add vector embeddings for semantic search
- Add a `search_files` tool with grep-like functionality

## Next Steps

- [**Chatbot with Sessions**](/recipes/chatbot-with-sessions) — Persistent conversations
- [**Tool Design Patterns**](/guides/tool-design-patterns) — Writing effective tools
