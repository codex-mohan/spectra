# @singularity-ai/spectra-code

> TUI coding agent with CLI commands, tools, and LLM integration.
>
> ✅ Feature gap analysis completed and gap document removed.

## Usage

```bash
# dev
bun dev

# build
bun run build

# run
bun start
```

## Exports

| Export | Description |
|--------|-------------|
| `launchTui` | Launch the terminal UI |
| `loadConfig` / `loadContext` | Configuration & context loading |
| `SessionStore` | Session persistence |
| `builtinTools` / `createAllTools` | Tool system |
| `shellTool`, `readTool`, `writeTool`, `editTool`, `grepTool`, `globTool`, `webFetchTool` | Built-in agent tools |
| `getPlatformInfo`, `getSystemPrompt` | Platform utils |
| `getGlobalConfigDir`, `getGlobalDataDir`, `getGlobalCacheDir` | Path resolution |

## CLI

```
spectra [command] [options]
```

## License

MIT