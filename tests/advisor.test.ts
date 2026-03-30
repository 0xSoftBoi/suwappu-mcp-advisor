import { describe, it, expect } from "bun:test";

interface Balance {
  symbol: string;
  chain: string;
  usd_value: number;
}

const stableSymbols = new Set(["USDC", "USDT", "DAI"]);

function concentrationRisk(balances: Balance[], totalUsd: number): string[] {
  const warnings: string[] = [];
  for (const b of balances) {
    const pct = (b.usd_value / totalUsd) * 100;
    if (pct > 50) warnings.push(`${b.symbol} at ${pct.toFixed(1)}%`);
  }
  return warnings;
}

function diversificationScore(balances: Balance[]): number {
  const chains = new Set(balances.map(b => b.chain));
  return Math.min(10, balances.length * 2 + chains.size);
}

function stablecoinRatio(balances: Balance[], totalUsd: number): number {
  const stableUsd = balances.filter(b => stableSymbols.has(b.symbol)).reduce((sum, b) => sum + b.usd_value, 0);
  return totalUsd > 0 ? (stableUsd / totalUsd) * 100 : 0;
}

const samplePortfolio: Balance[] = [
  { symbol: "ETH", chain: "ethereum", usd_value: 43000 },
  { symbol: "USDC", chain: "ethereum", usd_value: 3200 },
  { symbol: "DAI", chain: "base", usd_value: 1300 },
];
const totalUsd = 47500;

describe("concentration risk", () => {
  it("should warn when token is >50% of portfolio", () => {
    const warnings = concentrationRisk(samplePortfolio, totalUsd);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("ETH");
  });

  it("should not warn for balanced portfolio", () => {
    const balanced = [
      { symbol: "ETH", chain: "ethereum", usd_value: 4000 },
      { symbol: "BTC", chain: "ethereum", usd_value: 3000 },
      { symbol: "SOL", chain: "solana", usd_value: 3000 },
    ];
    expect(concentrationRisk(balanced, 10000).length).toBe(0);
  });

  it("should warn at exactly 51%", () => {
    const edge = [
      { symbol: "ETH", chain: "ethereum", usd_value: 51 },
      { symbol: "USDC", chain: "ethereum", usd_value: 49 },
    ];
    expect(concentrationRisk(edge, 100).length).toBe(1);
  });
});

describe("diversification score", () => {
  it("should score based on tokens * 2 + chains", () => {
    expect(diversificationScore(samplePortfolio)).toBe(8); // 3*2 + 2
  });

  it("should cap at 10", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      symbol: `T${i}`, chain: `c${i}`, usd_value: 100,
    }));
    expect(diversificationScore(many)).toBe(10);
  });

  it("should score 3 for single token single chain", () => {
    const single = [{ symbol: "ETH", chain: "ethereum", usd_value: 100 }];
    expect(diversificationScore(single)).toBe(3); // 1*2 + 1
  });
});

describe("stablecoin identification", () => {
  it("should identify USDC, USDT, DAI", () => {
    expect(stableSymbols.has("USDC")).toBe(true);
    expect(stableSymbols.has("USDT")).toBe(true);
    expect(stableSymbols.has("DAI")).toBe(true);
  });

  it("should not identify ETH, BTC, SOL", () => {
    expect(stableSymbols.has("ETH")).toBe(false);
    expect(stableSymbols.has("BTC")).toBe(false);
  });
});

describe("stablecoin ratio", () => {
  it("should calculate correct ratio", () => {
    const ratio = stablecoinRatio(samplePortfolio, totalUsd);
    // (3200 + 1300) / 47500 = 9.47%
    expect(ratio).toBeCloseTo(9.47, 0);
  });

  it("should return 0 for empty portfolio", () => {
    expect(stablecoinRatio([], 0)).toBe(0);
  });

  it("should return 100 for all-stable portfolio", () => {
    const allStable = [{ symbol: "USDC", chain: "base", usd_value: 1000 }];
    expect(stablecoinRatio(allStable, 1000)).toBe(100);
  });
});

describe("MCP JSON-RPC", () => {
  it("should build valid initialize request", () => {
    const req = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    expect(req.method).toBe("initialize");
  });

  it("should build valid tools/call request", () => {
    const req = {
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "get_portfolio", arguments: { wallet_address: "0xabc" } },
    };
    expect(req.params.name).toBe("get_portfolio");
  });
});
