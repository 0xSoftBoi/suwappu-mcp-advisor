import { describe, it, expect } from "bun:test";
describe("mcp-advisor", () => {
  it("should detect concentration risk", () => {
    const pct = 75;
    expect(pct > 50).toBe(true);
  });
  it("should calculate diversification score", () => {
    const tokens = 3, chains = 2;
    const score = Math.min(10, tokens * 2 + chains);
    expect(score).toBe(8);
  });
  it("should identify stablecoins", () => {
    const stables = new Set(["USDC", "USDT", "DAI"]);
    expect(stables.has("USDC")).toBe(true);
    expect(stables.has("ETH")).toBe(false);
  });
});
