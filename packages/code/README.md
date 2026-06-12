# Spectra Code

> AI coding agent in your terminal. Built on the Spectra agent framework.

Spectra Code is a terminal-native AI coding agent with a full-screen TUI, CLI commands, MCP integration, and ACP support for editor integration. It runs locally, respects your config, and keeps your API keys in a secure auth store.

## Features

- **TUI** — Full-screen terminal UI with session management, model switching, and real-time streaming
- **CLI** — Command-line interface for scripting and automation
- **Skills** — 65+ bundled skills (debugging, deployment, testing, collaboration) with TF-IDF search. User-defined skills override bundled defaults
- **Custom Tools** — Define your own tools as `.ts` files in `.spectra/tools/`; loaded automatically alongside built-in tools
- **MCP + ACP** — MCP client (stdio + HTTP) for external tool servers; ACP server (JSON-RPC 2.0) for editor integration with Zed, Neovim, JetBrains
- **Multiple agents** — Build, Plan, Debug, and Explore modes with tailored tool sets
- **Sessions** — Persistent session storage with fork, archive, revert, and checkpointing
- **Custom providers** — Register any LLM provider via the TUI or config
- **Auth store** — Secure API key management with file permissions
- **Cost tracking** — Real-time cost display in prompt bar, per-model pricing via models.dev, detailed cost dialog

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

## Skills

Specialized workflows the agent can discover and use. Ships with 65+ bundled skills covering debugging, deployment, testing, collaboration, security, and more.

Skills are discovered via the `find_skills` tool (TF-IDF search) and loaded on demand via the `skill` tool. The agent automatically searches for relevant skills when a task matches a known workflow.

**Three layers (user-defined wins on collision):**

| Layer | Location | Editable |
|-------|----------|----------|
| Project | `.claude/skills/`, `.agents/skills/` | Yes |
| User | `~/.claude/skills/`, `~/.agents/skills/` | Yes |
| Bundled | Inside the npm package | No |

Create your own skill by adding a `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-deploy
description: Deploy to my custom platform
when_to_use: when the user asks to deploy to our platform
---

# My Deploy

## Steps
1. Run tests
2. Build
3. Deploy via custom CLI
```

Skills override bundled defaults when placed in project or user directories.

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

## Security

Spectra Code runs with layered, configurable security — everything has sensible defaults but nothing is locked down.

### Permission System

Three-action model per tool and pattern: `allow`, `ask`, or `deny`. Everything defaults to `ask` unless configured.

```json
{
  "permission": {
    "*": "allow",
    "external_directory": { "*": "ask", "~/Downloads/*": "allow" },
    "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
    "write": { "*.env": "deny" }
  }
}
```

**Permission keys:** `read`, `write` (covers edit/write/apply_patch), `bash`, `grep`, `glob`, `web_fetch`, `task`, `external_directory`

### Tool Capabilities

Every tool declares its intent — `reads` (returns file content to the model) and/or `writes` (modifies files). Custom tools declare their own and automatically get guards and permission grouping.

| Tool | reads | writes |
|---|---|---|
| read, glob, grep | ✓ | |
| edit, write, apply_patch | | ✓ |
| bash | ✓ | ✓ |
| web_fetch, task | | |

### Read-Before-Write Guard

Applies to all write-capable tools. Files must be read before they can be overwritten. Modes:

- **soft** (default): first untracked write to existing file refused, second attempt allowed
- **strict**: permanent block until the file is read
- **off**: disabled entirely

### Path Safety

Sensitive paths blocked by default: `.ssh/`, `.aws/credentials`, `.gnupg/`, `/etc/shadow`, `.docker/config.json`, `.kube/config`, and more. Override via `allowedPaths`.

```json
{
  "security": {
    "blockedPaths": ["**/.ssh/**"],
    "allowedPaths": [".env.example"],
    "writeGuard": "soft",
    "writeGuardExclude": ["apply_patch"]
  }
}
```

### SSRF Guard

Blocks loopback and RFC1918 addresses for `web_fetch`. Configurable allowlist.

```json
{
  "security": {
    "ssrf": { "blockPrivate": true, "allowedHosts": ["api.internal.corp"] }
  }
}
```

### Doom Loop Detection

- Identical tool calls 3+ times → blocks the loop
- 8+ consecutive reads without writes → injects warning
- 4+ patch failures on same file → suggests rewrite

### File Checkpointing

Files are snapshotted before each turn. Ctrl+Shift+Y rolls back file changes. Everything is overridable — no hardcoded restrictions.

## Architecture

```
cli.ts              CLI entry point (yargs)
├── tui/            Full-screen terminal UI (React + @opentui)
├── commands/       CLI command handlers
├── services/       Config, session store, auth, snapshots
├── tools/          Built-in agent tools (read, write, edit, shell, grep, glob, web_fetch, task)
├── agents/         Agent definitions (build, plan, debug, explore)
├── security/       Permission engine, path safety, read tracker, doom loop, SSRF guard
├── skills/         Bundled skills (65+ workflows, TF-IDF indexed)
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

## License

MIT
