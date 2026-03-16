# pi-lsp

A [pi](https://github.com/badlogic/pi) extension that provides LSP diagnostics to the AI agent.

## Features

- **Auto-append on read** — LSP diagnostics are automatically appended when pi reads a file with issues
- **Standalone `diagnostics` tool** — The LLM can query diagnostics for any file on demand
- **Lazy server startup** — LSP servers spawn only when their activation condition is met
- **Eager startup on session start** — Servers matching the cwd are started immediately
- **Footer status** — Shows active LSP servers in the pi footer
- **`/lsp` command** — Lists all active LSP servers and their workspace roots
- **Configurable** — Easy to add new LSP servers via `config.ts`

## Supported Languages

- **TypeScript/JavaScript** — via `typescript-language-server`

## Adding a New LSP

Edit `src/config.ts` and add an entry to `LSP_CONFIGS`:

```ts
{
  name: "rust",
  command: "rust-analyzer",
  args: [],
  filePatterns: [/\.rs$/],
  condition: (root) => existsSync(join(root, "Cargo.toml")),
}
```

The `condition` function works like Neovim's `root_markers` — it checks if the project is relevant before spawning the server.

## Installation

Add to your `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["/path/to/pi-lsp-diagnostics/src/index.ts"]
}
```

Or symlink the directory into `~/.pi/agent/extensions/`.

## Prerequisites

LSP servers must be installed separately:

```bash
npm install -g typescript-language-server typescript
```

## License

MIT
