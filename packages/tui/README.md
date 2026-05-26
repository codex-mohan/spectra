# @singularity-ai/spectra-tui

**Minimal terminal UI framework with differential rendering for flicker-free interactive CLI applications.**

A lightweight, component-based TUI framework built from scratch on raw ANSI escape codes. No external UI dependencies — just a `TUI` core, a set of composable components (`Box`, `Text`, `Input`, `Editor`, `Loader`, `Markdown`, `Spacer`, `TruncatedText`), and a `ProcessTerminal` driver.

## Why Spectra?

Every agent framework I tried — **LangChain, LangGraph**, and others — followed the same pattern: endless layers of abstraction for things that are, at their core, just a simple loop. An agent takes input, calls a model, processes the response, dispatches tools, and repeats. That's it. A loop. Everything else — chains, graphs, runnables — is over-engineering dressed up as architecture. I lost months debugging framework bugs instead of building my product.

**Spectra TUI** is built on the same philosophy — just ANSI escape codes, differential rendering, and composable components. No bloated UI frameworks.

## Features

- **Differential rendering** — Only emits ANSI escape sequences for cells that changed. No full-screen redraws.
- **Component system** — Composable `Container` components with layout, focus management, and overlay support.
- **Kitty keyboard protocol** — Proper key event handling with press/release distinction and escape sequence parsing.
- **Markdown rendering** — Built-in `Markdown` component with syntax-aware line wrapping.
- **Editor component** — Multi-line text editor with theming support.

## Installation

```bash
bun add @singularity-ai/spectra-tui
```

## Quick Start

```typescript
import { TUI, ProcessTerminal, Box, Text } from "@singularity-ai/spectra-tui";

const terminal = new ProcessTerminal();
const tui = new TUI(terminal);

const root = new Box({ width: "100%", height: "100%" });
root.add(new Text({ content: "Hello, TUI!" }));
tui.setRoot(root);

// Start the event loop
const abort = new AbortController();
tui.run(abort.signal);
```

## Credits

Spectra was deeply inspired by **[pi-mono](https://github.com/badlogic/pi-mono)** by **Mario Zechner** — a beautifully minimal AI stack that proved an agent framework doesn't need layers of abstraction to be powerful.

## License

MIT
