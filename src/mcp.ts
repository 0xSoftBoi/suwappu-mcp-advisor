export const MCP_PROTOCOL_VERSION = "2025-06-18";

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export interface McpResource {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

interface JsonRpcEnvelope<T> {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

interface ToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

function defaultMcpUrl(): string {
  if (process.env.SUWAPPU_MCP_URL) return process.env.SUWAPPU_MCP_URL;
  const apiUrl = (process.env.SUWAPPU_API_URL ?? "https://api.suwappu.bot").replace(
    /\/+$/,
    "",
  );
  return `${apiUrl}/mcp`;
}

export function initializeParams() {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: {
      name: "suwappu-mcp-advisor",
      version: "1.1.0",
    },
  };
}

export function parseToolResult(result: ToolCallResult): unknown {
  const textPart = result.content?.find(
    (part) => part.type === "text" && typeof part.text === "string",
  );

  if (result.isError) {
    throw new Error(textPart?.text ?? "Suwappu MCP tool returned an error");
  }

  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  if (textPart?.text !== undefined) {
    try {
      return JSON.parse(textPart.text);
    } catch {
      return textPart.text;
    }
  }

  return result.content ?? [];
}

export class McpClient {
  private requestId = 0;
  readonly url: string;

  constructor(
    private readonly apiKey = "",
    url = defaultMcpUrl(),
  ) {
    this.url = url;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    const id = ++this.requestId;
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params,
      }),
    });

    const text = await response.text();
    let envelope: JsonRpcEnvelope<T> | undefined;
    if (text) {
      try {
        envelope = JSON.parse(text) as JsonRpcEnvelope<T>;
      } catch {
        throw new Error(
          `Suwappu MCP returned non-JSON HTTP ${response.status}: ${text.slice(0, 200)}`,
        );
      }
    }

    if (envelope?.error) {
      throw new Error(
        `MCP error ${envelope.error.code ?? "unknown"}: ${envelope.error.message ?? "unknown error"}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Suwappu MCP HTTP ${response.status}: ${text || response.statusText}`);
    }
    if (!envelope || envelope.result === undefined) {
      throw new Error(`MCP method ${method} returned no result`);
    }

    return envelope.result;
  }

  private async notify(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
    });
    if (!response.ok) {
      throw new Error(`MCP notification ${method} failed with HTTP ${response.status}`);
    }
  }

  async initialize(): Promise<{
    protocolVersion: string;
    capabilities: Record<string, unknown>;
    serverInfo: { name: string; version: string };
  }> {
    const result = await this.request<{
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    }>("initialize", initializeParams());

    await this.notify("notifications/initialized");
    return result;
  }

  async listTools(): Promise<McpTool[]> {
    const result = await this.request<{ tools?: McpTool[] }>("tools/list");
    return result.tools ?? [];
  }

  async listResources(): Promise<McpResource[]> {
    const result = await this.request<{ resources?: McpResource[] }>("resources/list");
    return result.resources ?? [];
  }

  async listPrompts(): Promise<McpPrompt[]> {
    const result = await this.request<{ prompts?: McpPrompt[] }>("prompts/list");
    return result.prompts ?? [];
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const result = await this.request<ToolCallResult>("tools/call", {
      name,
      arguments: args,
    });
    return parseToolResult(result);
  }
}
