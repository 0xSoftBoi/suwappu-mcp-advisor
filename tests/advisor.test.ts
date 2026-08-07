import { describe, expect, it } from "bun:test";
import { ruleBasedAnalysis, type Portfolio } from "../src/analysis.js";
import {
  encodeMcpHeaderValue,
  LEGACY_MCP_PROTOCOL_VERSION,
  legacyInitializeParams,
  MCP_PROTOCOL_VERSION,
  McpClient,
  type McpFetch,
  modernRequestParams,
  parseToolResult,
} from "../src/mcp.js";
import { assertAdvisorToolAllowed } from "../src/policy.js";

const concentrated: Portfolio = {
  balances: [
    {
      symbol: "ETH",
      chain: "ethereum",
      balance: "0.25",
      usd_value: 900,
    },
    {
      symbol: "USDC",
      chain: "base",
      balance: "100",
      usd_value: 100,
    },
  ],
  total_usd: 1000,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ruleBasedAnalysis", () => {
  it("emits neutral concentration flags grounded in held assets", () => {
    const result = ruleBasedAnalysis(concentrated, {
      ETH: { usd: 3600, change_24h: 2 },
      USDC: { usd: 1, change_24h: 0 },
    });

    expect(result.report).toContain("ETH is 90.0% of portfolio");
    expect(result.report).toContain("Stablecoins: $100.00 (10.0%)");
    expect(result.flags).toEqual([
      expect.objectContaining({ action: "reduce_concentration", token: "ETH" }),
    ]);
  });

  it("does not turn a price drop in an unheld asset into a buy instruction", () => {
    const result = ruleBasedAnalysis(concentrated, {
      SOL: { usd: 100, change_24h: -9 },
    });

    expect(result.report).toContain("DOWN: SOL -9.0% — research before acting");
    expect(result.flags.some((flag) => flag.token === "SOL")).toBe(false);
  });

  it("returns a consistent empty result for a zero-value portfolio", () => {
    const result = ruleBasedAnalysis({ balances: [], total_usd: 0 }, {});

    expect(result.report).toBe("Portfolio has no positive USD valuation to analyze.");
    expect(result.flags).toEqual([]);
  });
});

describe("MCP dual-era protocol", () => {
  it("builds self-describing 2026-07-28 requests and a legacy handshake fallback", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2026-07-28");
    expect(LEGACY_MCP_PROTOCOL_VERSION).toBe("2025-06-18");
    expect(modernRequestParams({ name: "get_prices" })).toMatchObject({
      name: "get_prices",
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": {
          name: "suwappu-mcp-advisor",
          version: "1.2.0",
        },
      },
    });
    expect(legacyInitializeParams()).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "suwappu-mcp-advisor",
        version: "1.2.0",
      },
    });
  });

  it("encodes MCP header values that are unsafe or sentinel-like", () => {
    expect(encodeMcpHeaderValue("get_prices")).toBe("get_prices");
    expect(encodeMcpHeaderValue(" padded ")).toBe("=?base64?IHBhZGRlZCA=?=");
    expect(encodeMcpHeaderValue("=?base64?literal?=")).toBe(
      "=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=",
    );
  });

  it("uses modern discovery and per-request headers when available", async () => {
    const seen: Array<{ method: string; headers: Headers; params: Record<string, unknown> }> = [];
    const fetcher: McpFetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as {
        method: string;
        params: Record<string, unknown>;
      };
      seen.push({ method: body.method, headers: new Headers(init?.headers), params: body.params });
      if (body.method === "server/discover") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          result: {
            resultType: "complete",
            supportedVersions: ["2026-07-28", "2025-06-18"],
            capabilities: { tools: {} },
            ttlMs: 60000,
            cacheScope: "public",
            _meta: {
              "io.modelcontextprotocol/serverInfo": { name: "Suwappu", version: "0.6.0" },
            },
          },
        });
      }
      return jsonResponse({
        jsonrpc: "2.0",
        id: 2,
        result: { resultType: "complete", tools: [] },
      });
    };

    const client = new McpClient("", "https://example.test/mcp", fetcher);
    const connection = await client.connect();
    await client.listTools();

    expect(connection).toMatchObject({
      era: "modern",
      protocolVersion: "2026-07-28",
      serverInfo: { name: "Suwappu", version: "0.6.0" },
    });
    expect(seen.map((request) => request.method)).toEqual([
      "server/discover",
      "tools/list",
    ]);
    expect(seen[0]?.headers.get("Mcp-Method")).toBe("server/discover");
    expect(seen[1]?.headers.get("MCP-Protocol-Version")).toBe("2026-07-28");
    expect(seen[1]?.params._meta).toBeDefined();
  });

  it("falls back to the 2025 handshake when a legacy server rejects discovery", async () => {
    const methods: string[] = [];
    const fetcher: McpFetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      methods.push(body.method);
      if (body.method === "server/discover") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found" },
        });
      }
      if (body.method === "initialize") {
        return jsonResponse({
          jsonrpc: "2.0",
          id: 2,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "Legacy Suwappu", version: "0.5.0" },
          },
        });
      }
      return new Response(null, { status: 204 });
    };

    const client = new McpClient("", "https://example.test/mcp", fetcher);
    const connection = await client.connect();

    expect(connection.era).toBe("legacy");
    expect(connection.protocolVersion).toBe("2025-06-18");
    expect(methods).toEqual([
      "server/discover",
      "initialize",
      "notifications/initialized",
    ]);
  });
});

describe("MCP tool result parsing", () => {
  it("prefers structuredContent when the server provides it", () => {
    expect(
      parseToolResult({
        structuredContent: { prices: { ETH: { usd: 3500 } } },
        content: [{ type: "text", text: "{\"ignored\":true}" }],
      }),
    ).toEqual({ prices: { ETH: { usd: 3500 } } });
  });

  it("falls back to JSON encoded in a text content block", () => {
    expect(
      parseToolResult({
        content: [{ type: "text", text: "{\"chains\":[\"base\"]}" }],
      }),
    ).toEqual({ chains: ["base"] });
  });

  it("fails closed on tool-level MCP errors", () => {
    expect(() =>
      parseToolResult({
        isError: true,
        content: [{ type: "text", text: "quote rejected" }],
      }),
    ).toThrow("quote rejected");
  });
});

describe("advisor capability policy", () => {
  it("allows only the small read/quote surface used by this example", () => {
    for (const name of ["get_portfolio", "get_prices", "list_chains", "get_quote"]) {
      expect(() => assertAdvisorToolAllowed(name)).not.toThrow();
    }
  });

  it("does not trust discovery or annotations as authorization", () => {
    for (const name of ["execute_swap", "simulate_swap", "list_wallet_policies"]) {
      expect(() => assertAdvisorToolAllowed(name)).toThrow(
        "outside the advisor's local allowlist",
      );
    }
  });
});
