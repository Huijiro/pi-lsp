import assert from "node:assert/strict";
import test from "node:test";
import { getLanguageId } from "./lsp-client.js";

const cases: Array<[string, string]> = [
  ["component.tsx", "typescriptreact"],
  ["module.mts", "typescript"],
  ["component.jsx", "javascriptreact"],
  ["script.mjs", "javascript"],
  ["main.py", "python"],
  ["main.go", "go"],
  ["source.cpp", "cpp"],
  ["header.h", "c"],
  ["styles.scss", "scss"],
  ["page.html", "html"],
  ["config.jsonc", "jsonc"],
  ["component.svelte", "svelte"],
  ["component.vue", "vue"],
  ["page.astro", "astro"],
  ["query.graphql", "graphql"],
  ["config.lua", "lua"],
  ["README.md", "plaintext"],
];

for (const [path, expected] of cases) {
  test(`${path} uses ${expected}`, () => {
    assert.equal(getLanguageId(path), expected);
  });
}
