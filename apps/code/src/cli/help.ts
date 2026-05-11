/**
 * Help text and logo for Spectra Code CLI.
 */

import { getVersion } from "./version.js";

const LOGO = `
  ███████╗██████╗ ███████╗ ██████╗████████╗██████╗  █████╗ 
  ██╔════╝██╔══██╗██╔════╝██╔════╝╚══██╔══╝██╔══██╗██╔══██╗
  ███████╗██████╔╝█████╗  ██║        ██║   ██████╔╝███████║
  ╚════██║██╔═══╝ ██╔══╝  ██║        ██║   ██╔══██╗██╔══██║
  ███████║██║     ███████╗╚██████╗   ██║   ██║  ██║██║  ██║
  ╚══════╝╚═╝     ╚══════╝ ╚═════╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝`;

const LOGO_COMPACT = "⚡ Spectra Code";

function c(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}\x1b[0m`;
}
function bold(text: string): string {
  return `\x1b[1m${text}\x1b[0m`;
}
function dim(text: string): string {
  return `\x1b[2m${text}\x1b[0m`;
}

export function printLogo(): void {
  const gradient = [39, 38, 75, 111, 147, 183];
  const lines = LOGO.split("\n").filter((l) => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const color = gradient[i % gradient.length];
    process.stdout.write(c(color, lines[i]) + "\n");
  }
  process.stdout.write("\n");
}

export function printHelp(): void {
  const version = getVersion();

  printLogo();

  process.stdout.write(`${bold("Spectra Code")} ${dim(`v${version}`)} — AI coding agent with read, write, edit, and bash tools

${bold("Usage:")}
  spectra ${dim("[options]")} ${dim("[messages...]")}

${bold("Options:")}
  ${c(75, "--help, -h")}                Show this help message and exit
  ${c(75, "--version, -v")}             Show version number and exit
  ${c(75, "--model <id>")}              Model identifier ${dim("(e.g. anthropic/claude-sonnet-4-20250514)")}
  ${c(75, "--provider <name>")}         Provider name ${dim("(anthropic, openai, openrouter, groq)")}
  ${c(75, "--api-key <key>")}           API key ${dim("(overrides environment variables)")}
  ${c(75, "--system-prompt <text>")}    Custom system prompt
  ${c(75, "--print, -p")}               Non-interactive mode: process prompt and exit
  ${c(75, "--continue, -c")}            Continue previous session
  ${c(75, "--no-session")}              Ephemeral session ${dim("(don't persist)")}
  ${c(75, "--cwd <dir>")}               Working directory ${dim("(default: current directory)")}
  ${c(75, "--verbose")}                 Verbose startup output

${bold("Environment Variables:")}
  ${c(183, "SPECTRA_MODEL")}               Model ID in provider/name format ${dim("(default: anthropic/claude-sonnet-4-20250514)")}
  ${c(183, "ANTHROPIC_API_KEY")}            Anthropic Claude API key
  ${c(183, "OPENAI_API_KEY")}               OpenAI API key
  ${c(183, "OPENROUTER_API_KEY")}           OpenRouter API key
  ${c(183, "GROQ_API_KEY")}                 Groq API key
  ${c(183, "API_KEY")}                      Fallback API key for any provider

${bold("Available Tools:")}
  ${c(111, "read")}    Read file contents
  ${c(111, "bash")}    Execute shell commands
  ${c(111, "edit")}    Edit files with find/replace
  ${c(111, "write")}   Write/create files
  ${c(111, "grep")}    Search file contents
  ${c(111, "find")}    Find files by glob pattern
  ${c(111, "ls")}      List directory contents

${bold("TUI Commands")} ${dim("(inside the interactive session):")}
  ${c(39, "/help")}         Show available commands
  ${c(39, "/clear")}        Clear conversation history
  ${c(39, "/model")}        Show current model
  ${c(39, "/compact")}      Compact context to reduce token usage
  ${c(39, "/quit")}         Quit Spectra Code

${bold("Keybindings:")}
  ${c(147, "Ctrl+P")}        Command palette
  ${c(147, "Ctrl+C")}        Abort current request
  ${c(147, "Ctrl+D")}        Quit
  ${c(147, "↑/↓")}           Navigate input history
  ${c(147, "Ctrl+A/E")}      Jump to start/end of line
  ${c(147, "Ctrl+K/U")}      Kill to end/start of line
  ${c(147, "Ctrl+Y")}        Yank (paste from kill ring)

${bold("Examples:")}
  ${dim("# Start interactive session")}
  spectra

  ${dim("# Start with initial prompt")}
  spectra "List all TypeScript files in src/"

  ${dim("# Use a specific model")}
  spectra --model openai/gpt-4o "Refactor this function"

  ${dim("# Non-interactive: process and exit")}
  spectra -p "What does package.json contain?"

  ${dim("# Continue previous session")}
  spectra --continue "What were we working on?"

  ${dim("# Combine provider and model flags")}
  spectra --provider openrouter --model deepseek/deepseek-chat "Explain this code"
`);
}

export function printVersion(): void {
  process.stdout.write(`spectra-code v${getVersion()}\n`);
}
