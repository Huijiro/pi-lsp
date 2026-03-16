import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type LspServerConfig } from "./config.js";

// LSP types (minimal subset)
export interface Diagnostic {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity?: number; // 1=Error, 2=Warning, 3=Info, 4=Hint
  message: string;
  source?: string;
  code?: number | string;
}

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const SEVERITY_MAP: Record<number, string> = {
  1: "error",
  2: "warning",
  3: "info",
  4: "hint",
};

/**
 * Minimal LSP client over stdio JSON-RPC.
 *
 * Lifecycle:
 *   1. spawn + initialize handshake
 *   2. didOpen files → collect publishDiagnostics notifications
 *   3. query diagnostics for opened files
 *   4. shutdown + exit on dispose
 */
export class LspClient {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private buffer = "";
  private diagnostics = new Map<string, Diagnostic[]>();
  private initialized = false;
  private openedFiles = new Set<string>();
  private diagnosticWaiters = new Map<
    string,
    { resolve: () => void; timer: ReturnType<typeof setTimeout> }
  >();
  private supportsPullDiagnostics = false;

  constructor(
    private config: LspServerConfig,
    private workspaceRoot: string,
  ) {}

  async start(): Promise<void> {
    this.process = spawn(this.config.command, this.config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.workspaceRoot,
    });

    this.process.stdout!.on("data", (chunk: Buffer) => {
      this.handleData(chunk.toString());
    });

    this.process.on("error", (err) => {
      console.error(`[lsp-diagnostics] ${this.config.name} process error:`, err.message);
    });

    this.process.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.error(`[lsp-diagnostics] ${this.config.name} exited with code ${code}`);
      }
      this.process = null;
    });

    // Initialize handshake
    const initResult = (await this.request("initialize", {
      processId: process.pid,
      capabilities: {
        textDocument: {
          publishDiagnostics: {
            relatedInformation: false,
          },
          diagnostic: {
            dynamicRegistration: false,
          },
        },
      },
      rootUri: `file://${this.workspaceRoot}`,
      workspaceFolders: [
        { uri: `file://${this.workspaceRoot}`, name: "root" },
      ],
      initializationOptions: this.config.initializationOptions ?? {},
    })) as { capabilities?: { diagnosticProvider?: unknown } } | undefined;

    // Check if server supports pull diagnostics
    if (initResult?.capabilities?.diagnosticProvider) {
      this.supportsPullDiagnostics = true;
    }

    this.notify("initialized", {});

    // Send settings if configured
    if (this.config.settings) {
      this.notify("workspace/didChangeConfiguration", {
        settings: this.config.settings,
      });
    }

    this.initialized = true;
  }

  /**
   * Open a file and wait for diagnostics to arrive.
   */
  async openFileAndGetDiagnostics(
    filePath: string,
    timeoutMs = 10000,
  ): Promise<Diagnostic[]> {
    if (!this.initialized || !this.process) return [];

    const absPath = resolve(filePath);
    const uri = `file://${absPath}`;

    // Open the file if not already open
    if (!this.openedFiles.has(uri)) {
      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        return [];
      }

      const languageId = this.getLanguageId(absPath);
      this.notify("textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      });
      this.openedFiles.add(uri);
    } else {
      // Re-read and send didChange for already-open files
      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        return [];
      }

      this.notify("textDocument/didChange", {
        textDocument: { uri, version: Date.now() },
        contentChanges: [{ text: content }],
      });
    }

    // Wait for push diagnostics notification
    await this.waitForDiagnostics(uri, this.supportsPullDiagnostics ? 2000 : timeoutMs);

    // If we got push diagnostics, return them
    const pushDiags = this.diagnostics.get(uri);
    if (pushDiags && pushDiags.length > 0) return pushDiags;

    // Try pull diagnostics as fallback
    if (this.supportsPullDiagnostics) {
      try {
        const result = (await this.request("textDocument/diagnostic", {
          textDocument: { uri },
        })) as { items?: Diagnostic[] } | undefined;
        if (result?.items) {
          this.diagnostics.set(uri, result.items);
          return result.items;
        }
      } catch {
        // Server may not support it despite advertising — fall through
      }
    }

    return pushDiags ?? [];
  }

  /**
   * Wait until we receive a publishDiagnostics notification for this URI,
   * or until timeout.
   */
  private waitForDiagnostics(uri: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      // If we already have diagnostics cached from a notification, resolve immediately
      // But we need to wait at least once for fresh results
      const existing = this.diagnosticWaiters.get(uri);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve();
      }

      const timer = setTimeout(() => {
        this.diagnosticWaiters.delete(uri);
        resolve();
      }, timeoutMs);

      this.diagnosticWaiters.set(uri, { resolve, timer });
    });
  }

  async dispose(): Promise<void> {
    if (!this.process || !this.initialized) {
      this.process?.kill();
      return;
    }

    try {
      await this.request("shutdown", null);
      this.notify("exit", null);
    } catch {
      // Best effort
    }

    this.process?.kill();
    this.process = null;

    // Clean up any pending waiters
    for (const [, waiter] of this.diagnosticWaiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
    this.diagnosticWaiters.clear();
  }

  // --- JSON-RPC transport ---

  private send(msg: JsonRpcMessage): void {
    if (!this.process?.stdin?.writable) return;
    const body = JSON.stringify(msg);
    const header = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n`;
    this.process.stdin.write(header + body);
  }

  private request(method: string, params: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });

      // Timeout after 30s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`LSP request ${method} timed out`));
        }
      }, 30000);
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private handleData(data: string): void {
    this.buffer += data;

    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) break;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Malformed, skip past header
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;

      if (this.buffer.length < bodyStart + contentLength) break; // incomplete

      const body = this.buffer.slice(bodyStart, bodyStart + contentLength);
      this.buffer = this.buffer.slice(bodyStart + contentLength);

      try {
        const msg = JSON.parse(body) as JsonRpcMessage;
        this.handleMessage(msg);
      } catch {
        // Skip malformed JSON
      }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    // Response to a request
    if (msg.id !== undefined && this.pending.has(msg.id as number)) {
      const handler = this.pending.get(msg.id as number)!;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        handler.reject(new Error(msg.error.message));
      } else {
        handler.resolve(msg.result);
      }
      return;
    }

    // Notification
    if (msg.method === "textDocument/publishDiagnostics") {
      const params = msg.params as {
        uri: string;
        diagnostics: Diagnostic[];
      };
      this.diagnostics.set(params.uri, params.diagnostics);

      // Resolve any waiters for this URI
      const waiter = this.diagnosticWaiters.get(params.uri);
      if (waiter) {
        clearTimeout(waiter.timer);
        this.diagnosticWaiters.delete(params.uri);
        waiter.resolve();
      }
    }
  }

  private getLanguageId(filePath: string): string {
    if (/\.tsx?$/.test(filePath)) return "typescript";
    if (/\.jsx?$/.test(filePath)) return "javascript";
    if (/\.mts$/.test(filePath)) return "typescript";
    if (/\.cts$/.test(filePath)) return "typescript";
    if (/\.mjs$/.test(filePath)) return "javascript";
    if (/\.cjs$/.test(filePath)) return "javascript";
    return "plaintext";
  }
}

/**
 * Format diagnostics into a concise string for the LLM.
 */
export function formatDiagnostics(
  filePath: string,
  diagnostics: Diagnostic[],
): string {
  if (diagnostics.length === 0) return "";

  const lines = diagnostics.map((d) => {
    const severity = SEVERITY_MAP[d.severity ?? 1] ?? "unknown";
    const line = d.range.start.line + 1;
    const col = d.range.start.character + 1;
    const source = d.source ? ` [${d.source}]` : "";
    const code = d.code !== undefined ? ` (${d.code})` : "";
    return `  ${line}:${col} ${severity}: ${d.message}${source}${code}`;
  });

  const errors = diagnostics.filter((d) => d.severity === 1).length;
  const warnings = diagnostics.filter((d) => d.severity === 2).length;
  const summary = [
    errors > 0 ? `${errors} error${errors > 1 ? "s" : ""}` : "",
    warnings > 0 ? `${warnings} warning${warnings > 1 ? "s" : ""}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return `\n--- LSP Diagnostics (${summary || `${diagnostics.length} issues`}) ---\n${lines.join("\n")}`;
}
