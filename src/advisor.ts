#!/usr/bin/env npx tsx
/**
 * Suwappu MCP Portfolio Advisor — TypeScript
 * Custom MCP client that discovers tools, fetches data, and generates investment advice.
 */

const MCP_URL = "https://api.suwappu.bot/mcp";

class McpClient {
  private apiKey: string;
  private requestId = 0;
  tools: Array<{ name: string; description?: string; inputSchema?: unknown }> = [];

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private nextId(): number {
    return ++this.requestId;
  }

  private async send(method: string, params: Record<string, unknown> = {}) {
    const response = await fetch(MCP_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.nextId(),
        method,
        params,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    if (data.error) {
      throw new Error(`MCP error ${data.error.code}: ${data.error.message}`);
    }
    return data.result;
  }

  async initialize() {
    const result = await this.send("initialize");
    const server = result.serverInfo;
    console.log(`Connected to ${server.name} v${server.version}`);
    console.log(`Protocol: ${result.protocolVersion}`);
    return result;
  }

  async listTools() {
    const result = await this.send("tools/list");
    this.tools = result.tools ?? [];
    return this.tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
    const result = await this.send("tools/call", { name, arguments: args });
    const content = result.content ?? [];
    for (const part of content) {
      if (part.type === "text") {
        try {
          return JSON.parse(part.text);
        } catch {
          return part.text;
        }
      }
    }
    return content;
  }
}

interface Balance {
  symbol: string;
  chain: string;
  balance: string;
  usd_value: number;
}

interface PriceData {
  usd: number;
  change_24h: number;
}

async function analyzeWithAi(
  portfolio: { balances: Balance[]; total_usd: number },
  prices: Record<string, PriceData>,
  chains: unknown
): Promise<string | null> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  const prompt = `You are a crypto portfolio advisor. Analyze this portfolio and provide actionable recommendations.

Portfolio Holdings:
${JSON.stringify(portfolio, null, 2)}

Current Prices (with 24h change):
${JSON.stringify(prices, null, 2)}

Supported Chains:
${JSON.stringify(chains, null, 2)}

Analyze for:
1. Concentration risk (any single token >50% of portfolio?)
2. Momentum signals (tokens with >5% 24h change)
3. Diversification score (how many tokens, how spread across chains)
4. Stablecoin ratio (is there enough stable allocation for risk management?)

Provide 2-3 specific trade recommendations with reasoning. Format as a clear report.`;

  if (openaiKey) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error: ${await res.text()}`);
    const data = await res.json();
    return data.choices[0].message.content;
  }

  if (anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);
    const data = await res.json();
    return data.content[0].text;
  }

  return null;
}

interface Recommendation {
  action: string;
  token: string;
  reason: string;
  target?: string;
}

function ruleBasedAnalysis(
  portfolio: { balances: Balance[]; total_usd: number },
  prices: Record<string, PriceData>
): { report: string; recommendations: Recommendation[] } {
  const { balances, total_usd } = portfolio;
  const recommendations: Recommendation[] = [];

  if (total_usd === 0) {
    return { report: "Portfolio is empty. Fund your wallet to get started.", recommendations: [] };
  }

  const lines: string[] = [];
  lines.push("=".repeat(55));
  lines.push("  PORTFOLIO ADVISORY REPORT");
  lines.push("=".repeat(55));

  // 1. Concentration risk
  lines.push("\n  1. CONCENTRATION RISK");
  for (const bal of balances) {
    const pct = (bal.usd_value / total_usd) * 100;
    if (pct > 50) {
      lines.push(`     WARNING: ${bal.symbol} is ${pct.toFixed(1)}% of portfolio (>50%)`);
      recommendations.push({
        action: "sell",
        token: bal.symbol,
        reason: `Over-concentrated at ${pct.toFixed(1)}%`,
        target: "Reduce to <40% by selling into USDC or diversifying",
      });
    } else if (pct > 30) {
      lines.push(`     WATCH: ${bal.symbol} at ${pct.toFixed(1)}% — approaching concentration limit`);
    } else {
      lines.push(`     OK: ${bal.symbol} at ${pct.toFixed(1)}%`);
    }
  }

  // 2. Momentum signals
  lines.push("\n  2. MOMENTUM SIGNALS (24h)");
  for (const [symbol, data] of Object.entries(prices)) {
    const change = data.change_24h ?? 0;
    if (change > 5) {
      lines.push(`     BULLISH: ${symbol} +${change.toFixed(1)}% — consider taking profits`);
    } else if (change < -5) {
      lines.push(`     BEARISH: ${symbol} ${change.toFixed(1)}% — potential buying opportunity`);
      const held = balances.some((b) => b.symbol === symbol);
      if (!held) {
        recommendations.push({
          action: "buy",
          token: symbol,
          reason: `Down ${change.toFixed(1)}% — potential dip buy`,
        });
      }
    } else {
      lines.push(`     NEUTRAL: ${symbol} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
    }
  }

  // 3. Diversification
  lines.push("\n  3. DIVERSIFICATION");
  const chains = new Set(balances.map((b) => b.chain));
  const score = Math.min(10, balances.length * 2 + chains.size);
  lines.push(`     Tokens held: ${balances.length}`);
  lines.push(`     Chains used: ${chains.size} (${[...chains].join(", ")})`);
  lines.push(`     Score: ${score}/10`);
  if (balances.length < 3) {
    lines.push("     TIP: Consider diversifying into at least 3-5 tokens");
  }

  // 4. Stablecoin ratio
  lines.push("\n  4. STABLECOIN RATIO");
  const stableSymbols = new Set(["USDC", "USDT", "DAI"]);
  const stableUsd = balances
    .filter((b) => stableSymbols.has(b.symbol))
    .reduce((sum, b) => sum + b.usd_value, 0);
  const stablePct = (stableUsd / total_usd) * 100;
  lines.push(`     Stablecoins: $${stableUsd.toLocaleString("en-US", { minimumFractionDigits: 2 })} (${stablePct.toFixed(1)}%)`);
  if (stablePct < 10) {
    lines.push("     WARNING: Low stablecoin allocation (<10%). Consider increasing for risk management.");
    recommendations.push({
      action: "rebalance",
      token: "USDC",
      reason: "Stablecoin allocation too low for risk management",
    });
  } else if (stablePct > 60) {
    lines.push("     NOTE: High stablecoin ratio (>60%). Capital may be underdeployed.");
  }

  // 5. Recommendations
  lines.push("\n  5. RECOMMENDATIONS");
  if (recommendations.length > 0) {
    recommendations.forEach((rec, i) => {
      lines.push(`     ${i + 1}. ${rec.action.toUpperCase()} ${rec.token}: ${rec.reason}`);
      if (rec.target) lines.push(`        → ${rec.target}`);
    });
  } else {
    lines.push("     No immediate action needed. Portfolio looks balanced.");
  }

  lines.push("");
  return { report: lines.join("\n"), recommendations };
}

async function main() {
  const apiKey = process.env.SUWAPPU_API_KEY;
  if (!apiKey) {
    console.error("Error: Set SUWAPPU_API_KEY environment variable.");
    process.exit(1);
  }

  const walletAddress = process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    console.error("Error: Set WALLET_ADDRESS environment variable.");
    process.exit(1);
  }

  // Step 1: Initialize MCP client
  console.log("Connecting to Suwappu MCP...");
  const client = new McpClient(apiKey);
  await client.initialize();

  // Step 2: Discover tools
  console.log("\nDiscovering tools...");
  const tools = await client.listTools();
  console.log(`Found ${tools.length} tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description ?? "No description"}`);
  }

  // Step 3: Fetch portfolio
  console.log(`\nFetching portfolio for ${walletAddress.slice(0, 10)}...${walletAddress.slice(-6)}...`);
  const portfolio = await client.callTool("get_portfolio", { wallet_address: walletAddress });

  if (!portfolio.balances?.length) {
    console.log("Portfolio is empty. Fund your wallet first.");
    process.exit(0);
  }

  console.log(`\nPortfolio value: $${portfolio.total_usd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
  for (const bal of portfolio.balances) {
    const pct = (bal.usd_value / portfolio.total_usd) * 100;
    console.log(
      `  ${bal.symbol.padStart(6)} | ${bal.balance.padStart(12)} | $${bal.usd_value.toFixed(2).padStart(10)} | ${pct.toFixed(1).padStart(5)}%`
    );
  }

  // Step 4: Fetch prices
  const symbols = portfolio.balances.map((b: Balance) => b.symbol);
  console.log(`\nFetching prices for ${symbols.join(", ")}...`);
  const priceResult = await client.callTool("get_prices", { symbols: symbols.join(",") });
  const priceData: Record<string, PriceData> = priceResult.prices ?? priceResult;

  for (const [symbol, data] of Object.entries(priceData)) {
    const change = data.change_24h ?? 0;
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "─";
    console.log(`  ${symbol}: $${data.usd.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${arrow} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`);
  }

  // Step 5: Fetch chains
  console.log("\nFetching supported chains...");
  const chains = await client.callTool("list_chains");

  // Step 6: Generate analysis
  console.log("\nAnalyzing portfolio...");
  const aiResult = await analyzeWithAi(portfolio, priceData, chains);

  let recommendations: Recommendation[] = [];
  if (aiResult) {
    console.log("\n" + aiResult);
  } else {
    console.log("\n(No AI key found — using rule-based analysis)");
    const analysis = ruleBasedAnalysis(portfolio, priceData);
    console.log(analysis.report);
    recommendations = analysis.recommendations;
  }

  // Step 7: Get quotes for recommendations
  if (recommendations.length > 0) {
    console.log("\nFetching quotes for recommended trades...");
    for (const rec of recommendations) {
      if (rec.action === "sell") {
        try {
          const quote = await client.callTool("get_quote", {
            from_token: rec.token,
            to_token: "USDC",
            amount: "0.1",
            chain: "ethereum",
          });
          console.log(`  Sample quote: 0.1 ${rec.token} → ${quote.to_amount ?? quote.amount_out ?? "?"} USDC`);
        } catch (e) {
          console.log(`  Could not quote ${rec.token}: ${e}`);
        }
      } else if (rec.action === "buy") {
        try {
          const quote = await client.callTool("get_quote", {
            from_token: "USDC",
            to_token: rec.token,
            amount: "100",
            chain: "ethereum",
          });
          console.log(`  Sample quote: 100 USDC → ${quote.to_amount ?? quote.amount_out ?? "?"} ${rec.token}`);
        } catch (e) {
          console.log(`  Could not quote ${rec.token}: ${e}`);
        }
      }
    }
  }

  console.log("\nDone. This is not financial advice — always do your own research.");
}

main().catch(console.error);
