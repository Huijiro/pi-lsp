# Contributing

## Adding a New LSP

All LSP server configs live in [`src/config.ts`](src/config.ts). To add a new language server, add an entry to the `LSP_CONFIGS` array.

### Config Structure

```ts
{
  name: "my-lsp",                    // Display name (shown in footer and /lsp)
  command: "my-language-server",     // Command to spawn
  args: ["--stdio"],                 // Arguments (most LSPs use --stdio)
  filePatterns: [/\.ext$/],          // Which files this LSP handles
  condition: (root) =>               // When to activate (like nvim root_markers)
    hasMarker(root, "config.file"),
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Short display name for the LSP. Shown in the footer status and `/lsp` command. |
| `command` | Yes | The executable to spawn. Must be available in `$PATH`. If not installed, the LSP is silently skipped. |
| `args` | Yes | Arguments passed to the command. Most LSP servers use `["--stdio"]`. |
| `filePatterns` | Yes | Array of regexes matched against file paths. Determines which files trigger this LSP. |
| `condition` | Yes | Function that receives the workspace root path and returns `true` if the LSP should activate. This is checked once per workspace root and cached. Use the `hasMarker()` helper to check for files. |
| `initializationOptions` | No | Object passed as `initializationOptions` in the LSP `initialize` request. |
| `settings` | No | Object sent via `workspace/didChangeConfiguration` after initialization. |

### The `condition` Function

This is the key to avoiding unnecessary LSP spawns. It works like Neovim's `root_markers` — check if the project is relevant before starting anything.

Use the `hasMarker()` helper:

```ts
// Simple: check for config files
condition: (root) => hasMarker(root, "Cargo.toml")

// Multiple markers
condition: (root) => hasMarker(root, "pyproject.toml", "setup.py", "requirements.txt")
```

For more complex checks (e.g., inspecting `package.json` dependencies):

```ts
condition: (root) => {
  try {
    const pkg = JSON.parse(
      require("node:fs").readFileSync(join(root, "package.json"), "utf-8"),
    );
    return "svelte" in { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return false;
  }
}
```

### Example: Adding Rust Analyzer

```ts
// Rust
{
  name: "rust",
  command: "rust-analyzer",
  args: [],
  filePatterns: [/\.rs$/],
  condition: (root) => hasMarker(root, "Cargo.toml"),
},
```

### Example: Adding Tailwind CSS

```ts
// Tailwind CSS
{
  name: "tailwindcss",
  command: "tailwindcss-language-server",
  args: ["--stdio"],
  filePatterns: [
    /\.(html|css|scss|jsx|tsx|vue|svelte)$/,
  ],
  condition: (root) =>
    hasMarker(
      root,
      "tailwind.config.js",
      "tailwind.config.cjs",
      "tailwind.config.mjs",
      "tailwind.config.ts",
    ),
  settings: {
    tailwindCSS: {
      validate: true,
    },
  },
},
```

### Tips

- **File pattern overlap is fine** — Multiple LSPs can match the same file. All matching LSPs will be queried and their diagnostics merged. For example, TypeScript and Biome both handle `.ts` files.
- **Keep conditions specific** — Don't use overly broad conditions like checking for `.git` alone unless the LSP is truly universal (like JSON).
- **Use `initializationOptions`** for options the server reads at startup.
- **Use `settings`** for runtime configuration sent via `workspace/didChangeConfiguration`.
- **The command check is automatic** — If the user doesn't have the LSP installed, it's silently skipped. No need to handle that in your config.

### Testing

1. Add your config to `src/config.ts`
2. Make sure the LSP server is installed
3. Open pi in a project that matches your `condition`
4. Check `/lsp` to see if the server started
5. Read a file with known issues and verify diagnostics appear

### Development Setup

```bash
git clone https://github.com/Huijiro/pi-lsp
cd pi-lsp
npm install

# Type check
npm run check

# Lint & format
npm run format

# Test locally by symlinking
ln -s $(pwd) ~/.pi/agent/extensions/pi-lsp
```
