# pi-lsp

A [pi](https://github.com/badlogic/pi) extension that gives the AI agent access to real-time LSP diagnostics.

## Features

- **Auto-append on read** — Diagnostics are automatically appended when pi reads a file with issues, so the agent sees errors and warnings in context
- **Standalone `diagnostics` tool** — The LLM can query diagnostics for any file on demand, useful after edits or to inspect a file's health
- **Lazy & eager startup** — LSP servers matching the cwd spawn at session start; others spawn lazily on first relevant file read
- **Nvim-style activation** — Each LSP has a `condition` function that checks for root markers (e.g., `tsconfig.json`, `Cargo.toml`) before spawning, just like Neovim's LSP config
- **Command availability check** — Servers are silently skipped if the command isn't installed
- **Multi-LSP support** — Multiple LSPs can report diagnostics for the same file (e.g., TypeScript + Biome)
- **Push & pull diagnostics** — Supports both `publishDiagnostics` notifications and `textDocument/diagnostic` requests
- **Footer status** — Shows active LSP servers in the pi footer
- **`/lsp` command** — Lists all active LSP servers

## Supported Languages

| Language | LSP Server | Activation |
|----------|-----------|------------|
| TypeScript / JavaScript | `typescript-language-server` | `tsconfig.json`, `jsconfig.json`, or `package.json` |
| Python | `pyright-langserver` | `pyproject.toml`, `setup.py`, `requirements.txt`, `Pipfile`, `pyrightconfig.json` |
| Go | `gopls` | `go.mod` or `go.work` |
| C / C++ | `clangd` | `compile_commands.json`, `compile_flags.txt`, `.clangd`, `CMakeLists.txt`, `Makefile` |
| Svelte | `svelteserver` | `svelte.config.js/ts` or `svelte` in `package.json` deps |
| CSS / SCSS / Less | `vscode-css-language-server` | `package.json` |
| HTML | `vscode-html-language-server` | `package.json` |
| JSON | `vscode-json-language-server` | `package.json` or `.git` |
| Biome (linter/formatter) | `biome lsp-proxy` | `biome.json` or `biome.jsonc` |
| Lua | `lua-language-server` | `.luarc.json`, `.stylua.toml`, `selene.toml`, etc. |

## Installation

```bash
pi install https://github.com/Huijiro/pi-lsp
```

Or add to your `~/.pi/agent/settings.json`:

```json
{
  "packages": [
    "https://github.com/Huijiro/pi-lsp"
  ]
}
```

### Prerequisites

LSP servers must be installed separately. Only install the ones you need:

```bash
# TypeScript / JavaScript
npm install -g typescript-language-server typescript

# Python
npm install -g pyright

# Go
go install golang.org/x/tools/gopls@latest

# C / C++
# Install clangd via your system package manager

# Svelte
npm install -g svelte-language-server

# CSS / HTML / JSON
npm install -g vscode-langservers-extracted

# Biome
npm install -g @biomejs/biome

# Lua
# Install lua-language-server via your system package manager
```

Missing servers are silently skipped — you only need to install what you use.

## Usage

Once installed, the extension works automatically:

- **Read a file** → diagnostics are appended if issues are found
- **Use the `diagnostics` tool** → the LLM can check any file on demand
- **Run `/lsp`** → see which LSP servers are active
- **Check the footer** → active LSPs are shown at the bottom

## Contributing

Want to add a new LSP? See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
