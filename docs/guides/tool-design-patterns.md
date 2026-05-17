# Tool Design Patterns

Best practices for writing tools that LLMs use effectively.

## 1. Write Clear Descriptions

The `description` field is the most important part of tool definition. The LLM uses it to decide when to call the tool.

```typescript
// ❌ Bad — too vague
defineTool({
  name: "search",
  description: "Search for things",
  // ...
});

// ✅ Good — specific about when to use
defineTool({
  name: "search_web",
  description: "Search the web for current information. Use when the user asks about recent events, news, or facts that may have changed since your training data. Do NOT use for general knowledge questions you can answer directly.",
  // ...
});
```

## 2. Describe Parameters Clearly

Each parameter should have a description:

```typescript
parameters: z.object({
  query: z.string().describe("The search query. Be specific and include relevant keywords, dates, and locations."),
  numResults: z.number().min(1).max(10).default(5).describe("Number of results to return. Use 3-5 for most queries."),
  dateRange: z.enum(["day", "week", "month", "year"]).optional().describe("Limit results to a time period. Use when the user specifies a timeframe."),
}),
```

## 3. Keep Tools Focused

One tool = one capability. Don't combine unrelated operations:

```typescript
// ❌ Bad — does too much
defineTool({
  name: "research_and_summarize",
  description: "Search the web and summarize the results",
  // ...
});

// ✅ Good — separate concerns
defineTool({
  name: "search_web",
  description: "Search the web for information",
  // ...
});

defineTool({
  name: "summarize_text",
  description: "Summarize a piece of text",
  // ...
});
```

## 4. Handle Errors Gracefully

Return useful error messages to the LLM:

```typescript
defineTool({
  name: "fetch_url",
  description: "Fetch the content of a URL",
  parameters: z.object({ url: z.string().url() }),
  execute: async ({ url }) => {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        return {
          content: [{ type: "text", text: `Failed to fetch ${url}: HTTP ${response.status}` }],
          isError: true,
        };
      }
      const text = await response.text();
      return { content: [{ type: "text", text: text.slice(0, 4000) }] };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error fetching ${url}: ${error.message}` }],
        isError: true,
      };
    }
  },
});
```

## 5. Truncate Long Results

LLMs have context limits. Don't return megabytes of data:

```typescript
const MAX_RESULT_LENGTH = 4000;

execute: async ({ url }) => {
  const text = await fetchContent(url);
  const truncated = text.length > MAX_RESULT_LENGTH
    ? text.slice(0, MAX_RESULT_LENGTH) + "\n\n[... truncated, use a more specific query for more details]"
    : text;
  return { content: [{ type: "text", text: truncated }] };
},
```

## 6. Use Progressive Disclosure

For complex data, return a summary first and let the LLM request details:

```typescript
defineTool({
  name: "list_files",
  description: "List files in a directory",
  parameters: z.object({
    path: z.string(),
    detailed: z.boolean().default(false).describe("If true, include file sizes and modification dates"),
  }),
  execute: async ({ path, detailed }) => {
    const files = await readdir(path);
    if (detailed) {
      const stats = await Promise.all(files.map(f => stat(join(path, f))));
      return { content: [{ type: "text", text: files.map((f, i) => `${f} (${stats[i].size} bytes)`).join("\n") }] };
    }
    return { content: [{ type: "text", text: files.join("\n") }] };
  },
});
```

## 7. Report Progress for Long Operations

Use `onUpdate` to keep the user informed:

```typescript
execute: async ({ url }, { onUpdate }) => {
  onUpdate?.({ content: [{ type: "text", text: "Downloading..." }] });
  const data = await download(url);
  onUpdate?.({ content: [{ type: "text", text: "Processing..." }] });
  const result = await process(data);
  return { content: [{ type: "text", text: result }] };
},
```

## Next Steps

- [**Tools Reference**](/typescript/tools) — defineTool API
- [**Error Handling**](/guides/error-handling) — Retry patterns
