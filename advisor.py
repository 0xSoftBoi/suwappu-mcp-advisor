#!/usr/bin/env python3
"""
Suwappu MCP Portfolio Advisor — Python
Custom MCP client that discovers tools, fetches data, and generates investment advice.
"""

import os
import sys
import json
import requests

MCP_URL = "https://api.suwappu.bot/mcp"


class McpClient:
    """Minimal MCP client wrapping the Suwappu MCP HTTP endpoint."""

    def __init__(self, api_key):
        self.api_key = api_key
        self.headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        self.request_id = 0
        self.tools = []

    def _next_id(self):
        self.request_id += 1
        return self.request_id

    def _send(self, method, params=None):
        """Send a JSON-RPC 2.0 request to the MCP endpoint."""
        payload = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": method,
            "params": params or {},
        }
        response = requests.post(MCP_URL, headers=self.headers, json=payload)
        response.raise_for_status()
        data = response.json()

        if "error" in data:
            raise Exception(f"MCP error {data['error']['code']}: {data['error']['message']}")

        return data["result"]

    def initialize(self):
        """Perform the MCP handshake."""
        result = self._send("initialize")
        server = result["serverInfo"]
        print(f"Connected to {server['name']} v{server['version']}")
        print(f"Protocol: {result['protocolVersion']}")
        return result

    def list_tools(self):
        """Discover available tools and their schemas."""
        result = self._send("tools/list")
        self.tools = result.get("tools", [])
        return self.tools

    def call_tool(self, name, arguments=None):
        """Call a tool by name and return parsed result."""
        result = self._send("tools/call", {
            "name": name,
            "arguments": arguments or {},
        })
        # MCP returns content as array of parts with JSON strings
        content = result.get("content", [])
        for part in content:
            if part["type"] == "text":
                try:
                    return json.loads(part["text"])
                except json.JSONDecodeError:
                    return part["text"]
        return content


def analyze_with_ai(portfolio_data, price_data, chains_data):
    """Use OpenAI or Anthropic to analyze the portfolio. Falls back to rules."""
    openai_key = os.environ.get("OPENAI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    prompt = f"""You are a crypto portfolio advisor. Analyze this portfolio and provide actionable recommendations.

Portfolio Holdings:
{json.dumps(portfolio_data, indent=2)}

Current Prices (with 24h change):
{json.dumps(price_data, indent=2)}

Supported Chains:
{json.dumps(chains_data, indent=2)}

Analyze for:
1. Concentration risk (any single token >50% of portfolio?)
2. Momentum signals (tokens with >5% 24h change)
3. Diversification score (how many tokens, how spread across chains)
4. Stablecoin ratio (is there enough stable allocation for risk management?)

Provide 2-3 specific trade recommendations with reasoning. Format as a clear report."""

    if openai_key:
        return _call_openai(openai_key, prompt)
    elif anthropic_key:
        return _call_anthropic(anthropic_key, prompt)
    else:
        return None


def _call_openai(api_key, prompt):
    """Call OpenAI API for analysis."""
    response = requests.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": "gpt-4o",
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.3,
        },
    )
    response.raise_for_status()
    return response.json()["choices"][0]["message"]["content"]


def _call_anthropic(api_key, prompt):
    """Call Anthropic API for analysis."""
    response = requests.post(
        "https://api.anthropic.com/v1/messages",
        headers={
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        },
        json={
            "model": "claude-sonnet-4-20250514",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
        },
    )
    response.raise_for_status()
    return response.json()["content"][0]["text"]


def rule_based_analysis(portfolio_data, price_data):
    """Simple rule-based analysis when no AI key is available."""
    balances = portfolio_data.get("balances", [])
    total_usd = portfolio_data.get("total_usd", 0)
    recommendations = []

    if total_usd == 0:
        return "Portfolio is empty. Fund your wallet to get started."

    report = []
    report.append("=" * 55)
    report.append("  PORTFOLIO ADVISORY REPORT")
    report.append("=" * 55)

    # 1. Concentration risk
    report.append("\n  1. CONCENTRATION RISK")
    for bal in balances:
        pct = (bal["usd_value"] / total_usd) * 100 if total_usd > 0 else 0
        if pct > 50:
            report.append(f"     WARNING: {bal['symbol']} is {pct:.1f}% of portfolio (>50%)")
            recommendations.append({
                "action": "sell",
                "token": bal["symbol"],
                "reason": f"Over-concentrated at {pct:.1f}%",
                "target": "Reduce to <40% by selling into USDC or diversifying",
            })
        elif pct > 30:
            report.append(f"     WATCH: {bal['symbol']} at {pct:.1f}% — approaching concentration limit")
        else:
            report.append(f"     OK: {bal['symbol']} at {pct:.1f}%")

    # 2. Momentum signals
    report.append("\n  2. MOMENTUM SIGNALS (24h)")
    for symbol, data in price_data.items():
        change = data.get("change_24h", 0)
        if change > 5:
            report.append(f"     BULLISH: {symbol} +{change:.1f}% — consider taking profits")
        elif change < -5:
            report.append(f"     BEARISH: {symbol} {change:.1f}% — potential buying opportunity")
            # Check if we already hold it
            held = any(b["symbol"] == symbol for b in balances)
            if not held:
                recommendations.append({
                    "action": "buy",
                    "token": symbol,
                    "reason": f"Down {change:.1f}% — potential dip buy",
                })
        else:
            report.append(f"     NEUTRAL: {symbol} {change:+.1f}%")

    # 3. Diversification
    report.append("\n  3. DIVERSIFICATION")
    num_tokens = len(balances)
    chains = set(b["chain"] for b in balances)
    score = min(10, num_tokens * 2 + len(chains))
    report.append(f"     Tokens held: {num_tokens}")
    report.append(f"     Chains used: {len(chains)} ({', '.join(chains)})")
    report.append(f"     Score: {score}/10")
    if num_tokens < 3:
        report.append("     TIP: Consider diversifying into at least 3-5 tokens")

    # 4. Stablecoin ratio
    report.append("\n  4. STABLECOIN RATIO")
    stable_symbols = {"USDC", "USDT", "DAI"}
    stable_usd = sum(b["usd_value"] for b in balances if b["symbol"] in stable_symbols)
    stable_pct = (stable_usd / total_usd) * 100 if total_usd > 0 else 0
    report.append(f"     Stablecoins: ${stable_usd:,.2f} ({stable_pct:.1f}%)")
    if stable_pct < 10:
        report.append("     WARNING: Low stablecoin allocation (<10%). Consider increasing for risk management.")
        recommendations.append({
            "action": "rebalance",
            "token": "USDC",
            "reason": "Stablecoin allocation too low for risk management",
        })
    elif stable_pct > 60:
        report.append("     NOTE: High stablecoin ratio (>60%). Capital may be underdeployed.")

    # 5. Recommendations
    report.append("\n  5. RECOMMENDATIONS")
    if recommendations:
        for i, rec in enumerate(recommendations, 1):
            report.append(f"     {i}. {rec['action'].upper()} {rec['token']}: {rec['reason']}")
            if "target" in rec:
                report.append(f"        → {rec['target']}")
    else:
        report.append("     No immediate action needed. Portfolio looks balanced.")

    report.append("")
    return "\n".join(report), recommendations


def main():
    api_key = os.environ.get("SUWAPPU_API_KEY")
    if not api_key:
        print("Error: Set SUWAPPU_API_KEY environment variable.")
        print("  export SUWAPPU_API_KEY=suwappu_sk_your_api_key")
        sys.exit(1)

    wallet_address = os.environ.get("WALLET_ADDRESS")
    if not wallet_address:
        print("Error: Set WALLET_ADDRESS environment variable.")
        print("  export WALLET_ADDRESS=0xYourWalletAddress")
        sys.exit(1)

    # Step 1: Initialize MCP client
    print("Connecting to Suwappu MCP...")
    client = McpClient(api_key)
    client.initialize()

    # Step 2: Discover tools
    print("\nDiscovering tools...")
    tools = client.list_tools()
    print(f"Found {len(tools)} tools:")
    for tool in tools:
        desc = tool.get("description", "No description")
        print(f"  - {tool['name']}: {desc}")

    # Step 3: Fetch portfolio
    print(f"\nFetching portfolio for {wallet_address[:10]}...{wallet_address[-6:]}...")
    portfolio = client.call_tool("get_portfolio", {
        "wallet_address": wallet_address,
    })

    if not portfolio.get("balances"):
        print("Portfolio is empty. Fund your wallet first.")
        sys.exit(0)

    # Print holdings
    print(f"\nPortfolio value: ${portfolio['total_usd']:,.2f}")
    for bal in portfolio["balances"]:
        pct = (bal["usd_value"] / portfolio["total_usd"]) * 100
        print(f"  {bal['symbol']:>6} | {bal['balance']:>12} | ${bal['usd_value']:>10,.2f} | {pct:>5.1f}%")

    # Step 4: Fetch prices
    symbols = [b["symbol"] for b in portfolio["balances"]]
    print(f"\nFetching prices for {', '.join(symbols)}...")
    prices = client.call_tool("get_prices", {
        "symbols": ",".join(symbols),
    })
    price_data = prices.get("prices", prices)

    for symbol, data in price_data.items():
        change = data.get("change_24h", 0)
        arrow = "▲" if change > 0 else "▼" if change < 0 else "─"
        print(f"  {symbol}: ${data['usd']:,.2f} {arrow} {change:+.1f}%")

    # Step 5: Fetch supported chains
    print("\nFetching supported chains...")
    chains = client.call_tool("list_chains")

    # Step 6: Generate analysis
    print("\nAnalyzing portfolio...")
    ai_result = analyze_with_ai(portfolio, price_data, chains)

    if ai_result:
        print("\n" + ai_result)
        recommendations = []  # AI provides its own recommendations
    else:
        print("\n(No AI key found — using rule-based analysis)")
        report, recommendations = rule_based_analysis(portfolio, price_data)
        print(report)

    # Step 7: Get quotes for recommendations
    if recommendations:
        print("\nFetching quotes for recommended trades...")
        for rec in recommendations:
            if rec["action"] == "sell":
                # Show quote for selling some of the overweight token
                try:
                    quote = client.call_tool("get_quote", {
                        "from_token": rec["token"],
                        "to_token": "USDC",
                        "amount": "0.1",  # Small sample amount
                        "chain": "ethereum",
                    })
                    print(f"  Sample quote: 0.1 {rec['token']} → {quote.get('to_amount', quote.get('amount_out', '?'))} USDC")
                except Exception as e:
                    print(f"  Could not quote {rec['token']}: {e}")
            elif rec["action"] == "buy":
                try:
                    quote = client.call_tool("get_quote", {
                        "from_token": "USDC",
                        "to_token": rec["token"],
                        "amount": "100",  # $100 sample
                        "chain": "ethereum",
                    })
                    print(f"  Sample quote: 100 USDC → {quote.get('to_amount', quote.get('amount_out', '?'))} {rec['token']}")
                except Exception as e:
                    print(f"  Could not quote {rec['token']}: {e}")

    print("\nDone. This is not financial advice — always do your own research.")


if __name__ == "__main__":
    main()
