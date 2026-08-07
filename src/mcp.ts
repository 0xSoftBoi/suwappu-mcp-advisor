export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const LEGACY_MCP_PROTOCOL_VERSION = "2025-06-18";

const CLIENT_INFO = {
  name: "suwappu-mcp-advisor",
  version: "1.2.0",
};
const PROTOCOL_VERSION_META = "io.modelcontextprotocol/protocolVersion";
const CLIENT_INFO_META = "io.modelcontextprotocol/clientInfo";
const CLIENT_CAPABILITIES_META = "io.modelcontextprotocol/clientCapabilities";
const SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";

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

export interface McpConnection {
  era: "modern" | "legacy";
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string };
}

export type McpFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface JsonRpcEnvelope<T> {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: { code?: number; message?: string; data?: unknown };
}

interface ModernResult {
  resultType?: string;
  _meta?: Record<string, unknown>;
}

interface DiscoverResult extends ModernResult {
  supportedVersions?: string[];
  capabilities?: Record<string, unknown>;
  instructions?: string;
  ttlMs?: number;
  cacheScope?: "public" | "private";
}

interface ToolCallResult extends ModernResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export class McpRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "McpRequestError";
  }
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function encodeMcpHeaderValue(value: string): string {
  const safeAscii = /^[\x20-\x7e]*$/.test(value);
  const hasEdgeWhitespace = value.trim() !== value;
  const looksEncoded = value.startsWith("=?base64?") && value.endsWith("?=");
  if (safeAscii && !hasEdgeWhitespace && !looksEncoded) return value;
  return `=?base64?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

export function modernRequestParams(
  params: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...params,
    _meta: {
      ...asRecord(params._meta),
      [PROTOCOL_VERSION_META]: MCP_PROTOCOL_VERSION,
      [CLIENT_INFO_META]: CLIENT_INFO,
      [CLIENT_CAPABILITIES_META]: {},
    },
  };
}

export function legacyInitializeParams() {
  return {
    protocolVersion: LEGACY_MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
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
  private era: "modern" | "legacy" | "" = "";
  readonly url: string;

  constructor(
    private readonly apiKey = "",
    url = defaultMcpUrl(),
    private readonly fetcher: McpFetch = fetch,
  ) {
    this.url = url;
  }

  private headers(
    mode: "modern" | "legacy",
    method: string,
    params: Record<string, unknown>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };

    if (mode === "modern") {
      headers["MCP-Protocol-Version"] = MCP_PROTOCOL_VERSION;
      headers["Mcp-Method"] = method;
      if (method === "tools/call" || method === "prompts/get") {
        if (typeof params.name === "string") {
          headers["Mcp-Name"] = encodeMcpHeaderValue(params.name);
        }
      } else if (method === "resources/read" && typeof params.uri === "string") {
        headers["Mcp-Name"] = encodeMcpHeaderValue(params.uri);
      }
      return headers;
    }

    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    if (this.negotiatedProtocol) {
      headers["MCP-Protocol-Version"] = this.negotiatedProtocol;
    }
    return headers;
  }

  private rememberLegacySession(response: Response): void {
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) this.sessionId = sessionId;
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown> = {},
    mode: "modern" | "legacy" = this.era === "modern" ? "modern" : "legacy",
  ): Promise<T> {
    const id = ++this.requestId;
    const wireParams = mode === "modern" ? modernRequestParams(params) : params;
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: this.headers(mode, method, params),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method,
        params: wireParams,
      }),
    });
    if (mode === "legacy") this.rememberLegacySession(response);

    const text = await response.text();
    let envelope: JsonRpcEnvelope<T> | undefined;
    try {
      envelope = decodeJsonRpcEnvelope<T>(
        text,
        response.headers.get("content-type") ?? "",
      );
    } catch (error) {
      if (!response.ok) {
        throw new McpRequestError(
          `Suwappu MCP HTTP ${response.status}: ${text || response.statusText}`,
          response.status,
        );
      }
      throw new Error(
        `MCP method ${method} returned an invalid response: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (envelope.error) {
      throw new McpRequestError(
        `MCP error ${envelope.error.code ?? "unknown"}: ${
          envelope.error.message ?? "unknown error"
        }`,
        response.status,
        envelope.error.code,
        envelope.error.data,
      );
    }
    if (!response.ok) {
      throw new McpRequestError(
        `Suwappu MCP HTTP ${response.status}: ${text || response.statusText}`,
        response.status,
      );
    }
    if (envelope.result === undefined) {
      throw new Error(`MCP method ${method} returned no result`);
    }

    if (mode === "modern") {
      if (
        !envelope.result ||
        typeof envelope.result !== "object" ||
        Array.isArray(envelope.result)
      ) {
        throw new Error(`MCP method ${method} returned a non-object modern result`);
      }
      const modern = envelope.result as ModernResult;
      if (modern.resultType === "input_required") {
        throw new Error(
          `MCP method ${method} requires another input round; this read-only example does not auto-fulfil MRTR requests`,
        );
      }
      if (modern.resultType !== "complete") {
        throw new Error(
          `MCP method ${method} returned invalid 2026-07-28 resultType: ${String(
            modern.resultType,
          )}`,
        );
      }
    }

    return envelope.result;
  }

  private async notify(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<void> {
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: this.headers("legacy", method, params),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
      }),
    });
    this.rememberLegacySession(response);

    if (!response.ok) {
      throw new Error(`MCP notification ${method} failed with HTTP ${response.status}`);
    }
  }

  private shouldFallBackToLegacy(error: unknown): boolean {
    if (!(error instanceof McpRequestError)) return false;
    if (error.code === -32020 || error.code === -32022) return false;
    return error.code === -32601 || (error.status >= 400 && error.status < 500);
  }

  private modernServerInfo(result: DiscoverResult): { name: string; version: string } {
    const meta = asRecord(result._meta);
    const info = asRecord(meta[SERVER_INFO_META]);
    return {
      name: typeof info.name === "string" ? info.name : "unknown",
      version: typeof info.version === "string" ? info.version : "unknown",
    };
  }

  private async connectModern(): Promise<McpConnection> {
    const result = await this.request<DiscoverResult>(
      "server/discover",
      {},
      "modern",
    );
    if (!result.supportedVersions?.includes(MCP_PROTOCOL_VERSION)) {
      throw new Error(
        `MCP server discovery did not advertise ${MCP_PROTOCOL_VERSION}; offered: ${
          result.supportedVersions?.join(", ") || "none"
        }`,
      );
    }

    this.era = "modern";
    this.negotiatedProtocol = MCP_PROTOCOL_VERSION;
    this.sessionId = "";
    return {
      era: "modern",
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: result.capabilities ?? {},
      serverInfo: this.modernServerInfo(result),
    };
  }

  private async connectLegacy(): Promise<McpConnection> {
    const result = await this.request<{
      protocolVersion: string;
      capabilities: Record<string, unknown>;
      serverInfo: { name: string; version: string };
    }>("initialize", legacyInitializeParams(), "legacy");

    this.era = "legacy";
    this.negotiatedProtocol = result.protocolVersion || LEGACY_MCP_PROTOCOL_VERSION;
    await this.notify("notifications/initialized");
    return {
      era: "legacy",
      protocolVersion: this.negotiatedProtocol,
      capabilities: result.capabilities ?? {},
      serverInfo: result.serverInfo ?? { name: "unknown", version: "unknown" },
    };
  }

  async connect(): Promise<McpConnection> {
    try {
      return await this.connectModern();
    } catch (error) {
      if (!this.shouldFallBackToLegacy(error)) throw error;
      return this.connectLegacy();
    }
  }

  async initialize(): Promise<McpConnection> {
    return this.connect();
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
