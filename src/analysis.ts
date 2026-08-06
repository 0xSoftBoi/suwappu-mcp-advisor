export interface Balance {
  symbol: string;
  chain: string;
  balance: string;
  usd_value: number;
}

export interface PriceData {
  usd: number;
  change_24h: number | null;
}

export interface Recommendation {
  action: "buy" | "sell" | "rebalance";
  token: string;
  reason: string;
  target?: string;
}

export interface Portfolio {
  balances: Balance[];
  total_usd: number;
}

const STABLE_SYMBOLS = new Set(["USDC", "USDT", "DAI"]);

export function ruleBasedAnalysis(
  portfolio: Portfolio,
  prices: Record<string, PriceData>,
): { report: string; recommendations: Recommendation[] } {
  const { balances, total_usd: totalUsd } = portfolio;
  const recommendations: Recommendation[] = [];

  if (!Number.isFinite(totalUsd) || totalUsd <= 0) {
    return {
      report: "Portfolio has no positive USD valuation to analyze.",
      recommendations,
    };
  }

  const lines: string[] = [
    "=".repeat(55),
    "  PORTFOLIO ADVISORY REPORT",
    "=".repeat(55),
    "\n  1. CONCENTRATION RISK",
  ];

  for (const balance of balances) {
    const pct = (balance.usd_value / totalUsd) * 100;
    if (pct > 50) {
      lines.push(
        `     WARNING: ${balance.symbol} is ${pct.toFixed(1)}% of portfolio (>50%)`,
      );
      recommendations.push({
        action: "sell",
        token: balance.symbol,
        reason: `Over-concentrated at ${pct.toFixed(1)}%`,
        target: "Research reducing concentration; do not execute from this report alone",
      });
    } else if (pct > 30) {
      lines.push(
        `     WATCH: ${balance.symbol} at ${pct.toFixed(1)}% — approaching concentration threshold`,
      );
    } else {
      lines.push(`     OK: ${balance.symbol} at ${pct.toFixed(1)}%`);
    }
  }

  lines.push("\n  2. MOMENTUM SIGNALS (24h)");
  for (const [symbol, data] of Object.entries(prices)) {
    const change = Number(data.change_24h ?? 0);
    if (change > 5) {
      lines.push(`     UP: ${symbol} +${change.toFixed(1)}% — review concentration/risk`);
    } else if (change < -5) {
      lines.push(`     DOWN: ${symbol} ${change.toFixed(1)}% — research before acting`);
      if (!balances.some((balance) => balance.symbol === symbol)) {
        recommendations.push({
          action: "buy",
          token: symbol,
          reason: `Down ${change.toFixed(1)}%; research signal only`,
        });
      }
    } else {
      lines.push(
        `     FLAT: ${symbol} ${change >= 0 ? "+" : ""}${change.toFixed(1)}%`,
      );
    }
  }

  lines.push("\n  3. DIVERSIFICATION");
  const chains = new Set(balances.map((balance) => balance.chain));
  const score = Math.min(10, balances.length * 2 + chains.size);
  lines.push(`     Tokens held: ${balances.length}`);
  lines.push(`     Chains used: ${chains.size} (${[...chains].join(", ")})`);
  lines.push(`     Heuristic score: ${score}/10`);

  lines.push("\n  4. STABLECOIN RATIO");
  const stableUsd = balances
    .filter((balance) => STABLE_SYMBOLS.has(balance.symbol.toUpperCase()))
    .reduce((sum, balance) => sum + balance.usd_value, 0);
  const stablePct = (stableUsd / totalUsd) * 100;
  lines.push(
    `     Stablecoins: $${stableUsd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
    })} (${stablePct.toFixed(1)}%)`,
  );
  if (stablePct < 10) {
    lines.push("     FLAG: Stablecoin allocation is below this example's 10% heuristic.");
    recommendations.push({
      action: "rebalance",
      token: "USDC",
      reason: "Stablecoin allocation below the example's 10% heuristic",
    });
  } else if (stablePct > 60) {
    lines.push("     FLAG: Stablecoin allocation is above this example's 60% heuristic.");
  }

  lines.push("\n  5. RESEARCH FLAGS");
  if (recommendations.length) {
    recommendations.forEach((recommendation, index) => {
      lines.push(
        `     ${index + 1}. ${recommendation.action.toUpperCase()} ${recommendation.token}: ${recommendation.reason}`,
      );
      if (recommendation.target) lines.push(`        → ${recommendation.target}`);
    });
  } else {
    lines.push("     No heuristic flags triggered.");
  }

  lines.push("");
  return { report: lines.join("\n"), recommendations };
}
