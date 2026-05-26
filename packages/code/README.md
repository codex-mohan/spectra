# Spectra Code

> AI coding agent in your terminal. Built on the Spectra agent framework.

Spectra Code is a terminal-native AI coding agent with a full-screen TUI, CLI commands, MCP integration, and ACP support for editor integration. It runs locally, respects your config, and keeps your API keys in a secure auth store.

## Why Spectra?

Every agent framework I tried — **LangChain, LangGraph**, and others — followed the same pattern: endless layers of abstraction for things that are, at their core, just a simple loop. An agent takes input, calls a model, processes the response, dispatches tools, and repeats. That's it. A loop. Everything else — chains, graphs, runnables — is over-engineering dressed up as architecture. I lost months debugging framework bugs instead of building my product.

**Spectra Code** is the proof that you don't need a bloated SDK to build a capable coding agent. Just a loop, tools, and a terminal.

## Features

- **TUI** — Full-screen terminal UI with session management, model switching, and real-time streaming
- **CLI** — Command-line interface for scripting and automation
- **Custom Tools** — Define your own tools as `.ts` files in `.spectra/tools/`; loaded automatically alongside built-in tools
- **MCP + ACP** — MCP client (stdio + HTTP) for external tool servers; ACP server (JSON-RPC 2.0) for editor integration with Zed, Neovim, JetBrains
- **Multiple agents** — Build, Plan, Debug, and Explore modes with tailored tool sets
- **Sessions** — Persistent session storage with fork, archive, revert, and checkpointing
- **Custom providers** — Register any LLM provider via the TUI or config
- **Auth store** — Secure API key management with file permissions

## Install

```bash
bun add @mohanscodex/spectra-code
```

Or run directly:

```bash
npx @mohanscodex/spectra-code
```

## Usage

### TUI (default)

```bash
spectra
```

Launches the full-screen terminal UI. Navigate with keyboard shortcuts, switch models, browse sessions, and chat with agents.

### CLI Commands

```bash
spectra session list           # List all sessions
spectra session delete --id <id>  # Delete a session
spectra agent list             # List available agent modes
spectra doctor                 # Run system health check
spectra db path                # Show data directory path
```

#### MCP Server Management

```bash
spectra mcp list                          # List configured MCP servers
spectra mcp add my-server --command "npx ..."  # Add a local MCP server
spectra mcp add my-api --url "https://..."     # Add a remote MCP server
spectra mcp connect my-server             # Connect to a server
spectra mcp disconnect my-server          # Disconnect
spectra mcp tools --server my-server      # List available tools
spectra mcp remove my-server              # Remove from config
```

### ACP

Use Spectra Code as the AI agent inside your editor:

```bash
spectra acp
```

Compatible with [any editor that supports ACP](https://agentclientprotocol.com) — Zed, Neovim (avante.nvim, CodeCompanion), JetBrains, and more.

#### Zed Configuration

Add to `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "Spectra Code": {
      "command": "spectra",
      "args": ["acp"]
    }
  }
}
```

#### Neovim (avante.nvim)

```lua
{
  acp_providers = {
    ["spectra"] = {
      command = "spectra",
      args = { "acp" }
    }
  }
}
```

## Custom Tools

Define your own tools the agent can call. Place `.ts` files in `.spectra/tools/` (project) or `~/.config/spectra/tools/` (global). Each file becomes a tool named after the filename.

```typescript
// .spectra/tools/weather.ts
import { z } from "zod";

export default {
  description: "Get current weather for a location",
  args: {
    location: z.string().describe("City name"),
  },
  async execute(args: { location: string }) {
    const res = await fetch(
      `https://api.weather.com/current?city=${encodeURIComponent(args.location)}`
    );
    const data = await res.json();
    return `Weather in ${args.location}: ${data.temp}°C, ${data.condition}`;
  },
};
```

Multiple tools per file using named exports:

```typescript
// .spectra/tools/math.ts
import { z } from "zod";

export const add = {
  description: "Add two numbers",
  args: { a: z.number(), b: z.number() },
  async execute(args: { a: number; b: number }) {
    return String(args.a + args.b);
  },
};

export const multiply = {
  description: "Multiply two numbers",
  args: { a: z.number(), b: z.number() },
  async execute(args: { a: number; b: number }) {
    return String(args.a * args.b);
  },
};
```

This creates two tools: `math_add` and `math_multiply`. Tools are loaded automatically by the ACP server and merged into the agent's toolset alongside built-in and MCP tools.

## Configuration

Spectra Code reads config from `spectra.json`, `opencode.json`, or `config.json` in the project or global config directory (`~/.config/spectra/` on Linux, `%LOCALAPPDATA%/spectra/Config/` on Windows).

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "agent": "build",
  "theme": "dark",
  "mcp": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    }
  ]
}
```

Environment variables: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `SPECTRA_MODEL`, `SPECTRA_PROVIDER`.

## Architecture

```
cli.ts              CLI entry point (yargs)
├── tui/            Full-screen terminal UI (React + @opentui)
├── commands/       CLI command handlers
├── services/       Config, session store, auth, snapshots
├── tools/          Built-in agent tools (read, write, edit, shell, grep, glob, web_fetch, task)
├── agents/         Agent definitions (build, plan, debug, explore)
└── integrations/
    ├── mcp/           MCP client (stdio + HTTP)
    ├── acp/           ACP server (JSON-RPC 2.0)
    └── custom-tools/  Custom tool loader
```

## API

```typescript
import { launchTui, loadConfig, SessionStore } from "@mohanscodex/spectra-code";
import { shellTool, readTool, writeTool } from "@mohanscodex/spectra-code";

const store = new SessionStore();
const sessions = store.list();
```

## Credits

Spectra was deeply inspired by **[pi-mono](https://github.com/badlogic/pi-mono)** by **Mario Zechner** — a beautifully minimal AI stack that proved an agent framework doesn't need layers of abstraction to be powerful.

## License

MIT
