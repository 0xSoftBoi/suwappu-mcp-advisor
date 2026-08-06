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

function decodeJsonRpcEnvelope<T>(
  text: string,
  contentType: string,
): JsonRpcEnvelope<T> {
  const candidates: string[] = [];

  if (contentType.includes("text/event-stream")) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data && data !== "[DONE]") candidates.push(data);
    }
  } else if (text) {
    candidates.push(text);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as JsonRpcEnvelope<T>;
      }
    } catch {
      // Try the next SSE event before failing the response.
    }
  }

  throw new Error("Suwappu MCP returned no decodable JSON-RPC message");
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
  private sessionId = "";
  private negotiatedProtocol = "";
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
      ...(this.sessionId ? { "Mcp-Session-Id": this.sessionId } : {}),
      ...(this.negotiatedProtocol
        ? { "MCP-Protocol-Version": this.negotiatedProtocol }
        : {}),
    };
  }

  private rememberSession(response: Response): void {
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) this.sessionId = sessionId;
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
    this.rememberSession(response);

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `Suwappu MCP HTTP ${response.status}: ${text || response.statusText}`,
      );
    }

    let envelope: JsonRpcEnvelope<T>;
    try {
      envelope = decodeJsonRpcEnvelope<T>(
        text,
        response.headers.get("content-type") ?? "",
      );
    } catch (error) {
      throw new Error(
        `MCP method ${method} returned an invalid response: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (envelope.error) {
      throw new Error(
        `MCP error ${envelope.error.code ?? "unknown"}: ${
          envelope.error.message ?? "unknown error"
        }`,
      );
    }
    if (envelope.result === undefined) {
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
    this.rememberSession(response);

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

    this.negotiatedProtocol = result.protocolVersion || MCP_PROTOCOL_VERSION;
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
