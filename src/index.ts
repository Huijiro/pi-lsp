/**
 * LSP Diagnostics Extension
 *
 * Provides LSP diagnostics to pi in two ways:
 * 1. Auto-appended to `read` tool results for matching files
 * 2. A standalone `diagnostics` tool the LLM can call on demand
 *
 * LSP servers are spawned lazily on first matching file read, and
 * only when the workspace condition is met (e.g. tsconfig.json exists).
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { findConfigsForFile, LSP_CONFIGS, type LspServerConfig } from "./config.js";
import { LspClient, formatDiagnostics, type Diagnostic } from "./lsp-client.js";

export default function lspDiagnostics(pi: ExtensionAPI) {
  // Cache: workspace root → LspClient (one server per root per config)
  const clients = new Map<string, LspClient>();
  // Cache: config name per client key (for status display)
  const clientNames = new Map<string, string>();
  // Cache: workspace root → condition result (avoid re-checking fs)
  const conditionCache = new Map<string, boolean>();
  // UI context reference for status updates
  let uiCtx: { setStatus: (id: string, text: string | undefined) => void } | null = null;

  const STATUS_MAX_LEN = 25;

  function updateStatus() {
    if (!uiCtx) return;
    if (clients.size === 0) {
      uiCtx.setStatus("lsp-diagnostics", undefined);
      return;
    }
    const names = [...new Set(clientNames.values())];
    let text = `LSP: ${names[0]}`;
    let shown = 1;
    for (let i = 1; i < names.length; i++) {
      const remaining = names.length - i;
      const suffix = `, and ${remaining} more`;
      const next = `${text}, ${names[i]}`;
      if (next.length > STATUS_MAX_LEN) {
        text += suffix;
        break;
      }
      text = next;
      shown++;
    }
    uiCtx.setStatus("lsp-diagnostics", text);
  }

  pi.on("session_start", async (_event, ctx) => {
    uiCtx = ctx.ui;

    // Eagerly spawn LSP servers whose conditions match the cwd
    await Promise.all(
      LSP_CONFIGS.map((config) => getClientForConfig(config, ctx.cwd)),
    );

    updateStatus();
  });

  /**
   * Resolve workspace root by walking up from the file looking for
   * common root markers. Falls back to cwd.
   */
  function findWorkspaceRoot(filePath: string, cwd: string): string {
    const markers = [
      "tsconfig.json",
      "jsconfig.json",
      "package.json",
      "Cargo.toml",
      "pyproject.toml",
      ".git",
    ];
    let dir = dirname(resolve(filePath));
    const root = "/";

    while (dir !== root) {
      for (const marker of markers) {
        if (existsSync(resolve(dir, marker))) return dir;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    return cwd;
  }

  // Cache: command name → installed
  const commandCache = new Map<string, boolean>();

  function isCommandInstalled(command: string): boolean {
    if (commandCache.has(command)) return commandCache.get(command)!;
    try {
      execFileSync("which", [command], { stdio: "ignore" });
      commandCache.set(command, true);
      return true;
    } catch {
      commandCache.set(command, false);
      return false;
    }
  }

  /**
   * Get or create an LSP client for a specific config and workspace root.
   * Returns null if the command isn't installed, condition isn't met, or startup fails.
   */
  async function getClientForConfig(
    config: LspServerConfig,
    workspaceRoot: string,
  ): Promise<LspClient | null> {
    if (!isCommandInstalled(config.command)) return null;

    const key = `${config.name}:${workspaceRoot}`;

    if (conditionCache.has(key)) {
      if (!conditionCache.get(key)) return null;
    } else {
      const shouldActivate = config.condition(workspaceRoot);
      conditionCache.set(key, shouldActivate);
      if (!shouldActivate) return null;
    }

    if (clients.has(key)) return clients.get(key)!;

    const client = new LspClient(config, workspaceRoot);
    try {
      await client.start();
      clients.set(key, client);
      clientNames.set(key, config.name);
      updateStatus();
      return client;
    } catch (err) {
      console.error(
        `[lsp-diagnostics] Failed to start ${config.name}:`,
        (err as Error).message,
      );
      conditionCache.set(key, false);
      return null;
    }
  }

  /**
   * Get all matching LSP clients for a file.
   */
  async function getClientsForFile(
    filePath: string,
    cwd: string,
  ): Promise<LspClient[]> {
    const configs = findConfigsForFile(filePath);
    if (configs.length === 0) return [];

    const workspaceRoot = findWorkspaceRoot(filePath, cwd);
    const results = await Promise.all(
      configs.map((config) => getClientForConfig(config, workspaceRoot)),
    );
    return results.filter((c): c is LspClient => c !== null);
  }

  /**
   * Get diagnostics for a file path from all matching LSP servers.
   */
  async function getDiagnostics(
    filePath: string,
    cwd: string,
  ): Promise<string> {
    const absPath = resolve(cwd, filePath);
    const lspClients = await getClientsForFile(absPath, cwd);
    if (lspClients.length === 0) return "";

    const allDiagnostics: Diagnostic[] = [];
    for (const client of lspClients) {
      try {
        const diagnostics = await client.openFileAndGetDiagnostics(absPath);
        allDiagnostics.push(...diagnostics);
      } catch (err) {
        console.error(
          `[lsp-diagnostics] Error getting diagnostics:`,
          (err as Error).message,
        );
      }
    }

    return formatDiagnostics(filePath, allDiagnostics);
  }

  // --- Hook: Append diagnostics to read tool results ---

  pi.on("tool_result", async (event, ctx) => {
    if (!uiCtx) uiCtx = ctx.ui;
    if (event.toolName !== "read") return;

    const input = event.input as { path?: string };
    if (!input.path) return;

    // Skip non-text files (images, etc.)
    const textContent = event.content?.find((c) => c.type === "text");
    if (!textContent) return;

    const diagnosticText = await getDiagnostics(input.path, ctx.cwd);
    if (!diagnosticText) return;

    // Append diagnostics to the existing text content
    const updatedContent = event.content.map((c) => {
      if (c.type === "text" && c === textContent) {
        return { ...c, text: c.text + diagnosticText };
      }
      return c;
    });

    return { content: updatedContent };
  });

  // --- Tool: Standalone diagnostics query ---

  pi.registerTool({
    name: "diagnostics",
    label: "LSP Diagnostics",
    description:
      "Get LSP diagnostics (errors, warnings) for a file. Use after editing to check for issues, or to inspect a file's health.",
    parameters: Type.Object({
      path: Type.String({ description: "File path to get diagnostics for" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const diagnosticText = await getDiagnostics(params.path, ctx.cwd);

      if (!diagnosticText) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No diagnostics available for ${params.path} (no matching LSP server or no issues found)`,
            },
          ],
          details: { path: params.path, count: 0 },
        };
      }

      return {
        content: [{ type: "text" as const, text: diagnosticText.trim() }],
        details: { path: params.path },
      };
    },
  });

  // --- Command: List active LSP servers ---

  pi.registerCommand("lsp", {
    description: "List active LSP servers",
    handler: async (_args, ctx) => {
      if (clients.size === 0) {
        ctx.ui.notify("No active LSP servers", "info");
        return;
      }
      const names = [...new Set(clientNames.values())];
      ctx.ui.notify(`Active LSPs: ${names.join(", ")}`, "info");
    },
  });

  // --- Cleanup: Shut down all LSP servers on session end ---

  pi.on("session_shutdown", async () => {
    const disposePromises = Array.from(clients.values()).map((c) =>
      c.dispose(),
    );
    await Promise.allSettled(disposePromises);
    clients.clear();
    clientNames.clear();
    conditionCache.clear();
    updateStatus();
  });
}
