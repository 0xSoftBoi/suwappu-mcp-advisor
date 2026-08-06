import { describe, expect, it } from "bun:test";
import { ruleBasedAnalysis, type Portfolio } from "../src/analysis.js";
import {
  MCP_PROTOCOL_VERSION,
  initializeParams,
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

describe("ruleBasedAnalysis", () => {
  it("uses the production concentration and stablecoin logic", () => {
    const result = ruleBasedAnalysis(concentrated, {
      ETH: { usd: 3600, change_24h: 2 },
      USDC: { usd: 1, change_24h: 0 },
    });

    expect(result.report).toContain("ETH is 90.0% of portfolio");
    expect(result.report).toContain("Stablecoins: $100.00 (10.0%)");
    expect(result.recommendations).toEqual([
      expect.objectContaining({ action: "sell", token: "ETH" }),
    ]);
  });

  it("returns a consistent empty result for a zero-value portfolio", () => {
    const result = ruleBasedAnalysis(
      { balances: [], total_usd: 0 },
      {},
    );

    expect(result.report).toBe("Portfolio has no positive USD valuation to analyze.");
    expect(result.recommendations).toEqual([]);
  });
});

describe("MCP handshake", () => {
  it("advertises the current protocol and client identity", () => {
    expect(MCP_PROTOCOL_VERSION).toBe("2025-06-18");
    expect(initializeParams()).toEqual({
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: {
        name: "suwappu-mcp-advisor",
        version: "1.1.0",
      },
    });
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
    for (const name of [
      "get_portfolio",
      "get_prices",
      "list_chains",
      "get_quote",
    ]) {
      expect(() => assertAdvisorToolAllowed(name)).not.toThrow();
    }
  });

  it("does not trust discovery or annotations as authorization", () => {
    for (const name of [
      "execute_swap",
      "simulate_swap",
      "list_wallet_policies",
    ]) {
      expect(() => assertAdvisorToolAllowed(name)).toThrow("outside the advisor's local allowlist");
    }
  });
});
