import { existsSync } from "node:fs";
import { join } from "node:path";

export interface LspServerConfig {
  /** Display name for this LSP */
  name: string;
  /** Command to spawn the LSP server */
  command: string;
  /** Arguments passed to the command */
  args: string[];
  /** File patterns this LSP handles */
  filePatterns: RegExp[];
  /** Check if this LSP should activate for a given workspace root */
  condition: (workspaceRoot: string) => boolean;
  /** LSP initialization options (passed in InitializeParams.initializationOptions) */
  initializationOptions?: Record<string, unknown>;
  /** LSP settings (sent via workspace/didChangeConfiguration) */
  settings?: Record<string, unknown>;
}

/**
 * Helper: returns true if any of the given marker files exist in the root.
 */
function hasMarker(root: string, ...markers: string[]): boolean {
  return markers.some((m) => existsSync(join(root, m)));
}

/**
 * Add new LSP configs here. Each entry defines when and how to spawn an LSP server.
 * The `condition` function works like nvim's root_markers — it checks if the project
 * is relevant before spawning anything.
 */
export const LSP_CONFIGS: LspServerConfig[] = [
  // TypeScript / JavaScript
  {
    name: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    filePatterns: [/\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/],
    condition: (root) =>
      hasMarker(root, "tsconfig.json", "jsconfig.json", "package.json"),
    initializationOptions: { hostInfo: "pi" },
  },

  // Python
  {
    name: "pyright",
    command: "pyright-langserver",
    args: ["--stdio"],
    filePatterns: [/\.py$/],
    condition: (root) =>
      hasMarker(
        root,
        "pyproject.toml",
        "setup.py",
        "setup.cfg",
        "requirements.txt",
        "Pipfile",
        "pyrightconfig.json",
      ),
    settings: {
      python: {
        analysis: {
          autoSearchPaths: true,
          useLibraryCodeForTypes: true,
          diagnosticMode: "openFilesOnly",
        },
      },
    },
  },

  // Go
  {
    name: "gopls",
    command: "gopls",
    args: [],
    filePatterns: [/\.(go)$/, /go\.(mod|sum|work)$/],
    condition: (root) => hasMarker(root, "go.mod", "go.work"),
  },

  // C / C++
  {
    name: "clangd",
    command: "clangd",
    args: [],
    filePatterns: [/\.(c|cpp|cc|cxx|h|hpp|hxx|m|mm)$/],
    condition: (root) =>
      hasMarker(
        root,
        "compile_commands.json",
        "compile_flags.txt",
        ".clangd",
        ".clang-tidy",
        "CMakeLists.txt",
        "Makefile",
      ),
  },

  // Svelte
  {
    name: "svelte",
    command: "svelteserver",
    args: ["--stdio"],
    filePatterns: [/\.svelte$/],
    condition: (root) =>
      hasMarker(root, "svelte.config.js", "svelte.config.ts") ||
      // Check package.json for svelte dependency
      (() => {
        try {
          const pkg = JSON.parse(
            require("node:fs").readFileSync(join(root, "package.json"), "utf-8"),
          );
          const deps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };
          return "svelte" in deps;
        } catch {
          return false;
        }
      })(),
  },

  // CSS
  {
    name: "css",
    command: "vscode-css-language-server",
    args: ["--stdio"],
    filePatterns: [/\.(css|scss|less)$/],
    condition: (root) => hasMarker(root, "package.json"),
    initializationOptions: { provideFormatter: true },
    settings: {
      css: { validate: true },
      scss: { validate: true },
      less: { validate: true },
    },
  },

  // HTML
  {
    name: "html",
    command: "vscode-html-language-server",
    args: ["--stdio"],
    filePatterns: [/\.html?$/],
    condition: (root) => hasMarker(root, "package.json"),
    initializationOptions: {
      provideFormatter: true,
      embeddedLanguages: { css: true, javascript: true },
      configurationSection: ["html", "css", "javascript"],
    },
  },

  // JSON
  {
    name: "json",
    command: "vscode-json-language-server",
    args: ["--stdio"],
    filePatterns: [/\.jsonc?$/],
    condition: (root) => hasMarker(root, "package.json", ".git"),
    initializationOptions: { provideFormatter: true },
  },

  // Tailwind CSS
  {
    name: "tailwindcss",
    command: "tailwindcss-language-server",
    args: ["--stdio"],
    filePatterns: [
      /\.(html|css|scss|less)$/,
      /\.(js|jsx|ts|tsx|mjs|cjs|mts|cts)$/,
      /\.(vue|svelte|astro)$/,
    ],
    condition: (root) =>
      hasMarker(
        root,
        "tailwind.config.js",
        "tailwind.config.cjs",
        "tailwind.config.mjs",
        "tailwind.config.ts",
        "postcss.config.js",
        "postcss.config.cjs",
        "postcss.config.mjs",
        "postcss.config.ts",
      ),
    settings: {
      tailwindCSS: {
        validate: true,
        lint: {
          cssConflict: "warning",
          invalidApply: "error",
          invalidScreen: "error",
          invalidVariant: "error",
          invalidConfigPath: "error",
          invalidTailwindDirective: "error",
          recommendedVariantOrder: "warning",
        },
      },
    },
  },

  // Biome
  {
    name: "biome",
    command: "biome",
    args: ["lsp-proxy"],
    filePatterns: [
      /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/,
      /\.(json|jsonc)$/,
      /\.(css|scss)$/,
      /\.(graphql|gql)$/,
      /\.(svelte|vue|astro)$/,
      /\.html?$/,
    ],
    condition: (root) => hasMarker(root, "biome.json", "biome.jsonc"),
  },

  // Lua
  {
    name: "lua",
    command: "lua-language-server",
    args: [],
    filePatterns: [/\.lua$/],
    condition: (root) =>
      hasMarker(
        root,
        ".luarc.json",
        ".luarc.jsonc",
        ".luacheckrc",
        ".stylua.toml",
        "stylua.toml",
        "selene.toml",
        "selene.yml",
      ),
  },
];

/**
 * Find all matching LSP configs for a given file path.
 */
export function findConfigsForFile(filePath: string): LspServerConfig[] {
  return LSP_CONFIGS.filter((config) =>
    config.filePatterns.some((pattern) => pattern.test(filePath)),
  );
}
