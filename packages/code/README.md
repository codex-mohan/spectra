# Spectra Code

> AI coding agent in your terminal. Built on the Spectra agent framework.

Spectra Code is a terminal-native coding agent with a full-screen TUI, CLI utilities, MCP tool-server support, ACP editor integration, custom tools, evolving skills, and configurable safety controls. It runs locally, keeps API keys in the system auth store, and adapts to your project through config files, `AGENTS.md`, skills, and custom tools.

## Features

- **Full-screen TUI** — Chat with agents, switch models/providers, manage sessions, view costs, and control permissions.
- **Agent modes** — `build`, `plan`, and `debug` modes with tailored tool access; `explore` is available as a fast read-only sub-agent.
- **Bundled and evolving skills** — 185+ bundled skills plus skills learned from sessions and custom user/project skills.
- **Custom tools** — Add `.ts` or `.js` tools in `.spectra/tools/`, `.opencode/tools/`, `.claude/tools/`, `.agents/tools/`, or the global Spectra config directory.
- **MCP integration** — Connect stdio and HTTP MCP servers and expose their tools to the agent.
- **ACP support** — Run as an Agent Client Protocol server for editors such as Zed, Neovim, JetBrains, and other ACP-compatible clients.
- **Persistent sessions** — Save, resume, fork, archive, and checkpoint conversations.
- **Configurable providers** — Use built-in providers or register custom OpenAI-compatible providers.
- **Security controls** — Permission rules, path safety, read-before-write guards, SSRF protection, and doom-loop detection.
- **Cost and token visibility** — Real-time cost display, token counts, and model pricing support.

## Install

Install the CLI globally:

```bash
bun add -g @mohanscodex/spectra-code
```

Or run once without installing:

```bash
npx @mohanscodex/spectra-code
# or
bunx @mohanscodex/spectra-code
```

Set an API key before running Spectra Code:

```bash
export ANTHROPIC_API_KEY="..."
# or
export SPECTRA_API_KEY="..."
```

Supported key sources include `SPECTRA_API_KEY`, `ANTHROPIC_API_KEY`, and `OPENAI_API_KEY`.

## Quick start

```bash
spectra
```

This launches the TUI in the current directory.

Useful first commands:

```bash
spectra doctor          # Check config, API key, shell, git, ripgrep, fd, and provider setup
spectra session list    # List saved sessions for the current project
spectra agent list      # List available agent modes
spectra mcp list        # List configured MCP servers
spectra acp             # Start the ACP server on stdio
```

## Usage

### TUI

Run the default command:

```bash
spectra
```

The TUI lets you:

- Chat with the selected agent.
- Switch between `build`, `plan`, and `debug` modes.
- Switch models and providers.
- Browse, resume, fork, archive, rename, and delete sessions.
- Manage permissions and security settings.
- View token usage, cost, tool calls, and model thinking output.
- Use slash commands such as `/sessions`, `/agent`, `/thinking`, `/tools`, `/permissions`, `/theme`, `/cost`, and `/doctor`.

### CLI

```bash
spectra session list
spectra session delete --id <id>
spectra agent list
spectra doctor
spectra db path
```

`session delete` can also be run without `--id` to select a session interactively.

### MCP

List configured servers:

```bash
spectra mcp list
```

Add a local stdio MCP server:

```bash
spectra mcp add filesystem --command "npx -y @modelcontextprotocol/server-filesystem ."
spectra mcp connect filesystem
spectra mcp tools --server filesystem
spectra mcp disconnect filesystem
```

Add a remote HTTP MCP server:

```bash
spectra mcp add my-api --url "https://example.com/mcp" --header "Authorization=Bearer ..."
spectra mcp connect my-api
```

Remove a server:

```bash
spectra mcp remove filesystem
```

MCP servers are stored in the Spectra config file as `mcp` entries.

### ACP

Run Spectra Code as an ACP-compatible agent:

```bash
spectra acp
```

Compatible with any editor that supports the [Agent Client Protocol](https://agentclientprotocol.com).

#### Zed

Add this to `~/.config/zed/settings.json`:

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

## Configuration

Spectra Code reads configuration from environment variables and JSON files.

Configuration files are discovered in this order, with closer project-level config taking precedence:

1. `SPECTRA_CONFIG` environment variable, parsed as JSON.
2. `spectra.json`, `spectra.jsonc`, `config.json`, `opencode.json`, or `opencode.jsonc` in discovered config directories.
3. Global config directory:
   - Linux/macOS: `~/.config/spectra/`
   - Windows: `%APPDATA%\spectra\`

Discovered project/user directories include `.spectra`, `.opencode`, `.claude`, and `.agents` found while walking from the current directory up to your home directory, plus `~/.spectra`.

Example `spectra.json`:

```json
{
  "model": "anthropic/claude-sonnet-4-20250514",
  "provider": "anthropic",
  "smallModel": "anthropic/claude-3-5-haiku-20241022",
  "agent": "build",
  "theme": "dark",
  "mcp": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "enabled": true
    }
  ],
  "providers": {
    "local-llm": {
      "name": "Local LLM",
      "baseUrl": "http://localhost:11434/v1",
      "models": {
        "local-model": {
          "name": "local-model",
          "contextWindow": 128000,
          "maxOutput": 32000
        }
      }
    }
  },
  "permission": {
    "read": { "*": "ask" },
    "write": { "*.env": "deny" },
    "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
    "external_directory": { "*": "ask", "~/Downloads/*": "allow" }
  },
  "security": {
    "writeGuard": "soft",
    "blockedPaths": ["**/.ssh/**", "**/.aws/credentials"],
    "allowedPaths": [".env.example"],
    "ssrf": {
      "blockPrivate": true,
      "allowedHosts": ["api.internal.corp"]
    }
  }
}
```

Useful environment variables:

- `SPECTRA_CONFIG` — JSON config object.
- `SPECTRA_MODEL` — default model.
- `SPECTRA_PROVIDER` — default provider.
- `SPECTRA_API_KEY` — API key override.
- `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` — provider-specific keys.

## Custom tools

Create a `tools` directory in any discovered config directory, such as `.spectra/tools/`, then add `.ts` or `.js` files.

Each default export becomes a tool named after the file. Named exports become `<file>_<export>` tools.

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

Multiple tools per file:

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

This creates `math_add` and `math_multiply`.

Custom tools can return a string or an MCP-style result:

```typescript
return {
  content: [{ type: "text", text: "Done" }],
};
```

## Skills

Skills are reusable workflows that Spectra Code can discover and load during a session.

Skill layers, from lowest to highest precedence:

| Layer | Location | Notes |
| --- | --- | --- |
| Bundled | Included in the npm package | Shipped with 185+ workflows |
| Evolving | `~/.spectra/skills/` | Generated from previous sessions |
| User/project | `.claude/skills/`, `.agents/skills/`, `~/.claude/skills/`, and other discovered skill directories | Override bundled and evolving skills |

Create a custom skill with a `SKILL.md` file:

```markdown
---
name: my-deploy
description: Deploy to my custom platform
when_to_use: when the user asks to deploy to our platform
---

# My Deploy

## Steps
1. Run tests.
2. Build the project.
3. Deploy with the custom platform CLI.
```

During a session, the agent can use `find_skills` to discover relevant skills and `skill` to load instructions.

## Security

Spectra Code uses layered safety controls that are configurable but not hardcoded.

### Permissions

Permission rules use `allow`, `ask`, or `deny`.

```json
{
  "permission": {
    "*": "ask",
    "read": { "*": "ask" },
    "write": { "*.env": "deny" },
    "bash": { "git *": "allow", "rm *": "deny", "*": "ask" },
    "external_directory": { "*": "ask", "~/Downloads/*": "allow" }
  }
}
```

Supported permission keys include:

- `read`
- `write`
- `bash`
- `grep`
- `glob`
- `web_fetch`
- `task`
- `external_directory`

### Read-before-write guard

Write-capable tools can require files to be read before they are overwritten.

```json
{
  "security": {
    "writeGuard": "soft",
    "writeGuardExclude": ["apply_patch"]
  }
}
```

Modes:

| Mode | Behavior |
| --- | --- |
| `soft` | First untracked write to an unread file is refused; a second attempt is allowed. |
| `strict` | Writes are blocked until the file has been read. |
| `off` | Disabled. |

### Path safety

Block sensitive paths by default and allow specific exceptions:

```json
{
  "security": {
    "blockedPaths": ["**/.ssh/**", "**/.aws/credentials", "**/.gnupg/**"],
    "allowedPaths": [".env.example"]
  }
}
```

### SSRF guard

`web_fetch` can block loopback and private-network addresses:

```json
{
  "security": {
    "ssrf": {
      "blockPrivate": true,
      "blockLoopback": true,
      "allowedHosts": ["api.internal.corp"],
      "followRedirects": false
    }
  }
}
```

### Doom-loop detection

Spectra Code detects repeated or unproductive tool loops and can warn or stop the agent when it sees patterns such as repeated identical calls, long read-only loops, or repeated patch failures.

## Sessions and checkpoints

Sessions are stored in the global data directory:

- Linux: `~/.local/share/spectra/sessions/sessions.db`
- macOS: `~/Library/Application Support/spectra/sessions/sessions.db`
- Windows: `%LOCALAPPDATA%\spectra\sessions\sessions.db`

File snapshots are stored separately under the global data directory and are used for checkpoints and rollback.

## Architecture

```text
src/cli.ts                         CLI entry point
src/tui/                           Full-screen TUI with React and @opentui
src/agents/                        Agent definitions and tool filtering
src/commands/                      CLI command implementations
src/integrations/                  MCP client, ACP server, custom tool loader
src/services/                      Config, sessions, auth store, context, snapshots
src/tools/                         Built-in tools and tool composition
src/security/                      Permissions, path safety, read tracking, SSRF, doom-loop detection
src/utils/                         Platform and filesystem helpers
skills/                            Bundled skill library
```

## API

Use the package programmatically:

```typescript
import {
  launchTui,
  loadConfig,
  loadContext,
  SessionStore,
  builtinTools,
  shellTool,
  readTool,
  writeTool,
  getGlobalDataDir,
} from "@mohanscodex/spectra-code";

const config = loadConfig();
const store = new SessionStore();
const sessions = store.list(process.cwd());
```

Exported helpers include:

- `launchTui`
- `loadConfig`
- `loadContext`
- `SessionStore`
- MCP helpers such as `connectServer`, `disconnectServer`, `listConnectedServers`, and `listServerTools`
- Tool helpers such as `builtinTools`, `createAllTools`, `createAllToolsWithMcp`, and `createAllToolsWithExtensions`
- Built-in tools such as `shellTool`, `readTool`, `writeTool`, `editTool`, `grepTool`, `globTool`, and `webFetchTool`
- Platform helpers such as `getPlatformInfo`, `getSystemPrompt`, `getGlobalConfigDir`, `getGlobalDataDir`, and `getGlobalCacheDir`

## Development

```bash
bun install
bun run build
bun run dev
bun run lint
bun test
```

Package scripts:

| Script | Command |
| --- | --- |
| `build` | `tsc` |
| `dev` | `bun src/cli.ts` |
| `start` | `bun src/cli.ts` |
| `spectra:help` | `tsx src/cli.ts --help` |
| `test` | `vitest --run` |
| `lint` | `tsc --noEmit` |

## Troubleshooting

### No API key found

Run `spectra doctor` and set one of:

```bash
export SPECTRA_API_KEY="..."
export ANTHROPIC_API_KEY="..."
export OPENAI_API_KEY="..."
```

### MCP server fails to connect

Check the command or URL in `spectra mcp list`, then try:

```bash
spectra mcp connect <server-name>
spectra mcp tools --server <server-name>
```

Make sure the MCP server command is available on `PATH`.

### Slow file search

Install `ripgrep` and `fd` for faster `grep` and `glob` fallbacks:

```bash
# macOS
brew install ripgrep fd

# Windows
winget install BurntSushi.ripgrep.MSVC
winget install sharkdp.fd
```

### Custom tool does not load

Place the file in a discovered `tools` directory, for example `.spectra/tools/`, and export either a default tool or named tools. Load errors are printed to the console.

## License

MIT
