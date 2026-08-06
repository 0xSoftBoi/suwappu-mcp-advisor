#!/usr/bin/env bun
/**
 * Suwappu MCP Portfolio Advisor
 *
 * A small hosted-MCP client example. The advisory path is intentionally
 * read-only. Optional --quotes may call get_quote, but this program never calls
 * execute_swap (unsigned transaction preparation) or a managed execution API.
 */

import {
  ruleBasedAnalysis,
  type Balance,
  type Portfolio,
  type PriceData,
  type Recommendation,
} from "./analysis.js";
import { McpClient, type McpTool } from "./mcp.js";
import {
  ADVISOR_TOOL_ALLOWLIST,
  assertAdvisorToolAllowed,
} from "./policy.js";

const args = new Set(process.argv.slice(2));

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Malformed ${label} result from MCP`);
  }
  return value as Record<string, unknown>;
}

function parsePortfolio(value: unknown): Portfolio {
  const raw = asRecord(value, "get_portfolio");
  const rawBalances = Array.isArray(raw.balances) ? raw.balances : [];
  const balances: Balance[] = rawBalances.map((item) => {
    const balance = asRecord(item, "portfolio balance");
    const usdValue = Number(balance.usd_value);
    if (!Number.isFinite(usdValue) || usdValue < 0) {
      throw new Error("Portfolio contains an invalid usd_value");
    }
    return {
      symbol: String(balance.symbol ?? balance.token ?? ""),
      chain: String(balance.chain ?? ""),
      balance: String(balance.balance ?? "0"),
      usd_value: usdValue,
    };
  });

  const reportedTotal = Number(raw.total_usd);
  const totalUsd = Number.isFinite(reportedTotal)
    ? reportedTotal
    : balances.reduce((sum, balance) => sum + balance.usd_value, 0);

  return { balances, total_usd: totalUsd };
}

function parsePrices(value: unknown): Record<string, PriceData> {
  const raw = asRecord(value, "get_prices");
  const source = raw.prices && typeof raw.prices === "object" && !Array.isArray(raw.prices)
    ? (raw.prices as Record<string, unknown>)
    : raw;

  const prices: Record<string, PriceData> = {};
  for (const [symbol, value] of Object.entries(source)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const usd = Number(entry.usd);
    const change = entry.change_24h;
    if (!Number.isFinite(usd) || usd <= 0) continue;
    prices[symbol.toUpperCase()] = {
      usd,
      change_24h:
        change === null || change === undefined
          ? null
          : Number.isFinite(Number(change))
            ? Number(change)
            : null,
    };
  }
  return prices;
}

async function callAdvisorTool<T>(
  client: McpClient,
  name: string,
  toolArgs: Record<string, unknown> = {},
): Promise<T> {
  assertAdvisorToolAllowed(name);
  return (await client.callTool(name, toolArgs)) as T;
}

function verifyRequiredTools(tools: McpTool[]): void {
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of ADVISOR_TOOL_ALLOWLIST) {
    if (!names.has(name)) {
      throw new Error(`Hosted MCP server is missing expected tool: ${name}`);
    }
  }
}

async function renderCatalog(client: McpClient): Promise<void> {
  const initialized = await client.initialize();
  const [tools, resources, prompts] = await Promise.all([
    client.listTools(),
    client.listResources(),
    client.listPrompts(),
  ]);

  console.log(
    `Connected to ${initialized.serverInfo.name} v${initialized.serverInfo.version} (MCP ${initialized.protocolVersion})`,
  );
  console.log(`\nTools (${tools.length}):`);
  for (const tool of tools) {
    const hint = tool.annotations?.readOnlyHint === true
      ? "read-only hint"
      : tool.name === "execute_swap"
        ? "unsigned transaction preparation"
        : "inspect semantics";
    console.log(`  - ${tool.name} [${hint}]`);
  }

  console.log(`\nResources (${resources.length}):`);
  for (const resource of resources) console.log(`  - ${resource.uri}`);

  console.log(`\nPrompts (${prompts.length}):`);
  for (const prompt of prompts) console.log(`  - ${prompt.name}`);

  console.log(
    "\nMCP annotations are descriptive hints, not an authorization mechanism. Clients still need a local capability policy.",
  );
}

async function analyzeWithAi(
  portfolio: Portfolio,
  prices: Record<string, PriceData>,
  chains: unknown,
): Promise<string | null> {
  const prompt = `Analyze this crypto portfolio as a research exercise. Do not imply that any trade has been approved or executed.

Portfolio:
${JSON.stringify(portfolio, null, 2)}

Prices:
${JSON.stringify(prices, null, 2)}

Supported chains:
${JSON.stringify(chains, null, 2)}

Discuss concentration, 24h moves, diversification, and stablecoin exposure. Clearly label assumptions and research flags.`;

  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiModel = process.env.OPENAI_MODEL;
  if (openaiKey && openaiModel) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: openaiModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI error ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const anthropicModel = process.env.ANTHROPIC_MODEL;
  if (anthropicKey && anthropicModel) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: anthropicModel,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!response.ok) {
      throw new Error(`Anthropic error ${response.status}: ${await response.text()}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    return data.content?.find((part) => part.type === "text")?.text ?? null;
  }

  return null;
}

async function showIllustrativeQuotes(
  client: McpClient,
  portfolio: Portfolio,
  recommendations: Recommendation[],
): Promise<void> {
  console.log(
    "\nIllustrative quotes (--quotes): get_quote is read-only; no transaction is prepared, signed, or broadcast.",
  );

  for (const recommendation of recommendations) {
    try {
      if (recommendation.action === "sell") {
        const holding = portfolio.balances.find(
          (balance) => balance.symbol === recommendation.token,
        );
        const balance = Number(holding?.balance);
        if (!holding || !Number.isFinite(balance) || balance <= 0 || !holding.chain) {
          console.log(`  Skip ${recommendation.token}: no usable held balance/chain.`);
          continue;
        }

        const amount = Math.min(balance, 0.1);
        const quote = await callAdvisorTool<Record<string, unknown>>(
          client,
          "get_quote",
          {
            from_token: recommendation.token,
            to_token: "USDC",
            amount: String(amount),
            chain: holding.chain,
          },
        );
        console.log(
          `  ${amount} ${recommendation.token} → ${String(
            quote.to_amount ?? quote.amount_out ?? "?",
          )} USDC on ${holding.chain}`,
        );
      } else if (recommendation.action === "buy") {
        const funding = portfolio.balances.find(
          (balance) => balance.symbol.toUpperCase() === "USDC" && balance.chain,
        );
        const available = Number(funding?.balance);
        if (!funding || !Number.isFinite(available) || available <= 0) {
          console.log(
            `  Skip ${recommendation.token}: no USDC balance/chain to ground an illustrative quote.`,
          );
          continue;
        }

        const amount = Math.min(available, 100);
        const quote = await callAdvisorTool<Record<string, unknown>>(
          client,
          "get_quote",
          {
            from_token: "USDC",
            to_token: recommendation.token,
            amount: String(amount),
            chain: funding.chain,
          },
        );
        console.log(
          `  ${amount} USDC → ${String(
            quote.to_amount ?? quote.amount_out ?? "?",
          )} ${recommendation.token} on ${funding.chain}`,
        );
      }
    } catch (error) {
      console.log(
        `  Quote unavailable for ${recommendation.token}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const apiKey = process.env.SUWAPPU_API_KEY ?? "";
  const client = new McpClient(apiKey);

  if (args.has("--catalog")) {
    await renderCatalog(client);
    return;
  }

  if (!apiKey) throw new Error("SUWAPPU_API_KEY is required for portfolio analysis");
  const walletAddress = requireEnv("WALLET_ADDRESS");
  if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    throw new Error(
      "WALLET_ADDRESS must be the authenticated agent's 0x-prefixed managed EVM wallet",
    );
  }

  const initialized = await client.initialize();
  const tools = await client.listTools();
  verifyRequiredTools(tools);
  console.log(
    `Connected to ${initialized.serverInfo.name} v${initialized.serverInfo.version}; discovered ${tools.length} tools.`,
  );
  console.log(
    `Advisor-local capability set: ${[...ADVISOR_TOOL_ALLOWLIST].join(", ")}`,
  );

  const portfolio = parsePortfolio(
    await callAdvisorTool(client, "get_portfolio", {
      wallet_address: walletAddress,
    }),
  );
  if (!portfolio.balances.length || portfolio.total_usd <= 0) {
    console.log("Portfolio has no positive balance valuation to analyze.");
    return;
  }

  console.log(
    `\nPortfolio value: $${portfolio.total_usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
    })}`,
  );
  for (const balance of portfolio.balances) {
    const pct = (balance.usd_value / portfolio.total_usd) * 100;
    console.log(
      `  ${balance.symbol.padStart(6)} | ${balance.balance.padStart(12)} | $${balance.usd_value
        .toFixed(2)
        .padStart(10)} | ${pct.toFixed(1).padStart(5)}%`,
    );
  }

  const symbols = [...new Set(portfolio.balances.map((balance) => balance.symbol))];
  const prices = parsePrices(
    await callAdvisorTool(client, "get_prices", {
      symbols: symbols.join(","),
    }),
  );
  const chains = await callAdvisorTool(client, "list_chains");

  const analysis = ruleBasedAnalysis(portfolio, prices);
  const aiAnalysis = await analyzeWithAi(portfolio, prices, chains);
  if (aiAnalysis) {
    console.log("\nAI research notes:\n");
    console.log(aiAnalysis);
    console.log("\nHeuristic cross-check:\n");
  } else {
    console.log(
      "\n(No AI provider + model configured — using the deterministic heuristic.)\n",
    );
  }
  console.log(analysis.report);

  if (args.has("--quotes") && analysis.recommendations.length) {
    await showIllustrativeQuotes(client, portfolio, analysis.recommendations);
  }

  console.log(
    "\nDone. This example never calls execute_swap and never submits managed execution.",
  );
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
