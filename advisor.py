#!/usr/bin/env python3
"""Suwappu hosted-MCP portfolio advisor example.

The advisory path is intentionally non-transactional. It can optionally request
read-only quotes with --quotes, but it never calls execute_swap and never calls
the managed REST execution endpoint.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from typing import Any

import requests

MCP_PROTOCOL_VERSION = "2025-06-18"
DEFAULT_MCP_URL = "https://api.suwappu.bot/mcp"
REQUEST_TIMEOUT_SECONDS = 30
ADVISOR_TOOL_ALLOWLIST = {
    "get_portfolio",
    "get_prices",
    "list_chains",
    "get_quote",
}


def _decode_jsonrpc_response(response: requests.Response) -> dict[str, Any]:
    """Decode either JSON or the single-message SSE form allowed by MCP HTTP."""
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" not in content_type:
        data = response.json()
        if not isinstance(data, dict):
            raise RuntimeError("MCP returned a non-object JSON-RPC response")
        return data

    for block in re.split(r"\r?\n\r?\n", response.text):
        data_lines = [
            line[5:].lstrip()
            for line in block.splitlines()
            if line.startswith("data:")
        ]
        if not data_lines:
            continue
        payload = "\n".join(data_lines)
        if payload == "[DONE]":
            continue
        data = json.loads(payload)
        if isinstance(data, dict):
            return data

    raise RuntimeError("MCP returned an SSE response without a JSON-RPC message")


class McpClient:
    """Small Streamable HTTP client for Suwappu's hosted MCP endpoint."""

    def __init__(self, api_key: str = "", url: str | None = None):
        self.api_key = api_key
        self.url = url or os.environ.get("SUWAPPU_MCP_URL", DEFAULT_MCP_URL)
        self.request_id = 0
        self.session_id: str | None = None
        self.negotiated_protocol: str | None = None

    def _headers(self) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        if self.negotiated_protocol:
            headers["MCP-Protocol-Version"] = self.negotiated_protocol
        return headers

    def _post(self, payload: dict[str, Any]) -> requests.Response:
        response = requests.post(
            self.url,
            headers=self._headers(),
            json=payload,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        session_id = response.headers.get("Mcp-Session-Id")
        if session_id:
            self.session_id = session_id
        return response

    def _next_id(self) -> int:
        self.request_id += 1
        return self.request_id

    def _send(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        response = self._post(
            {
                "jsonrpc": "2.0",
                "id": self._next_id(),
                "method": method,
                "params": params or {},
            }
        )
        data = _decode_jsonrpc_response(response)
        if "error" in data:
            error = data["error"]
            raise RuntimeError(
                f"MCP error {error.get('code', 'unknown')}: "
                f"{error.get('message', 'unknown error')}"
            )
        result = data.get("result")
        if not isinstance(result, dict):
            raise RuntimeError(f"MCP method {method} returned no object result")
        return result

    def _notify(
        self,
        method: str,
        params: dict[str, Any] | None = None,
    ) -> None:
        self._post(
            {
                "jsonrpc": "2.0",
                "method": method,
                "params": params or {},
            }
        )

    def initialize(self) -> dict[str, Any]:
        result = self._send(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": "suwappu-mcp-advisor-python",
                    "version": "1.1.0",
                },
            },
        )
        self.negotiated_protocol = str(
            result.get("protocolVersion", MCP_PROTOCOL_VERSION)
        )
        self._notify("notifications/initialized")
        return result

    def list_tools(self) -> list[dict[str, Any]]:
        result = self._send("tools/list")
        tools = result.get("tools", [])
        return tools if isinstance(tools, list) else []

    def list_resources(self) -> list[dict[str, Any]]:
        result = self._send("resources/list")
        resources = result.get("resources", [])
        return resources if isinstance(resources, list) else []

    def list_prompts(self) -> list[dict[str, Any]]:
        result = self._send("prompts/list")
        prompts = result.get("prompts", [])
        return prompts if isinstance(prompts, list) else []

    def call_tool(
        self,
        name: str,
        arguments: dict[str, Any] | None = None,
    ) -> Any:
        result = self._send(
            "tools/call",
            {"name": name, "arguments": arguments or {}},
        )
        content = result.get("content", [])
        text = next(
            (
                part.get("text")
                for part in content
                if isinstance(part, dict)
                and part.get("type") == "text"
                and isinstance(part.get("text"), str)
            ),
            None,
        )

        if result.get("isError"):
            raise RuntimeError(text or "Suwappu MCP tool returned an error")

        if "structuredContent" in result:
            return result["structuredContent"]

        if text is not None:
            try:
                return json.loads(text)
            except json.JSONDecodeError:
                return text

        return content


def assert_advisor_tool_allowed(name: str) -> None:
    if name not in ADVISOR_TOOL_ALLOWLIST:
        raise RuntimeError(
            f'Tool "{name}" is outside the advisor local allowlist. '
            "This example never calls transaction-preparation or execution tools."
        )


def call_advisor_tool(
    client: McpClient,
    name: str,
    arguments: dict[str, Any] | None = None,
) -> Any:
    assert_advisor_tool_allowed(name)
    return client.call_tool(name, arguments)


def parse_portfolio(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise RuntimeError("Malformed get_portfolio result from MCP")

    raw_balances = value.get("balances", [])
    if not isinstance(raw_balances, list):
        raw_balances = []

    balances: list[dict[str, Any]] = []
    for raw in raw_balances:
        if not isinstance(raw, dict):
            continue
        usd_value = float(raw.get("usd_value", raw.get("usdValue", 0)))
        if usd_value < 0:
            raise RuntimeError("Portfolio contains an invalid usd_value")
        balances.append(
            {
                "symbol": str(raw.get("symbol", raw.get("token", ""))),
                "chain": str(raw.get("chain", "")),
                "balance": str(raw.get("balance", "0")),
                "usd_value": usd_value,
            }
        )

    reported_total = value.get("total_usd", value.get("totalUsd"))
    try:
        total_usd = float(reported_total)
    except (TypeError, ValueError):
        total_usd = sum(balance["usd_value"] for balance in balances)

    return {"balances": balances, "total_usd": total_usd}


def parse_prices(value: Any) -> dict[str, dict[str, float | None]]:
    if not isinstance(value, dict):
        raise RuntimeError("Malformed get_prices result from MCP")
    source = value.get("prices", value)
    if not isinstance(source, dict):
        return {}

    prices: dict[str, dict[str, float | None]] = {}
    for symbol, raw in source.items():
        if not isinstance(raw, dict):
            continue
        usd_raw = raw.get("usd", raw.get("priceUsd", raw.get("price_usd")))
        try:
            usd = float(usd_raw)
        except (TypeError, ValueError):
            continue
        if usd <= 0:
            continue

        change_raw = raw.get("change_24h", raw.get("change24h"))
        try:
            change = None if change_raw is None else float(change_raw)
        except (TypeError, ValueError):
            change = None

        prices[str(symbol).upper()] = {"usd": usd, "change_24h": change}
    return prices


def rule_based_analysis(
    portfolio: dict[str, Any],
    prices: dict[str, dict[str, float | None]],
) -> tuple[str, list[dict[str, str]]]:
    balances = portfolio.get("balances", [])
    total_usd = float(portfolio.get("total_usd", 0) or 0)
    recommendations: list[dict[str, str]] = []

    if total_usd <= 0:
        return "Portfolio has no positive USD valuation to analyze.", recommendations

    lines = [
        "=" * 55,
        "  PORTFOLIO ADVISORY REPORT",
        "=" * 55,
        "\n  1. CONCENTRATION RISK",
    ]
    for balance in balances:
        pct = (float(balance["usd_value"]) / total_usd) * 100
        if pct > 50:
            lines.append(
                f"     WARNING: {balance['symbol']} is {pct:.1f}% of portfolio (>50%)"
            )
            recommendations.append(
                {
                    "action": "sell",
                    "token": str(balance["symbol"]),
                    "reason": f"Over-concentrated at {pct:.1f}%; research signal only",
                }
            )
        elif pct > 30:
            lines.append(
                f"     WATCH: {balance['symbol']} at {pct:.1f}% — review concentration"
            )
        else:
            lines.append(f"     OK: {balance['symbol']} at {pct:.1f}%")

    lines.append("\n  2. MOMENTUM SIGNALS (24h)")
    for symbol, data in prices.items():
        change = float(data.get("change_24h") or 0)
        if change > 5:
            lines.append(
                f"     UP: {symbol} +{change:.1f}% — review concentration/risk"
            )
        elif change < -5:
            lines.append(f"     DOWN: {symbol} {change:.1f}% — research before acting")
        else:
            lines.append(f"     FLAT: {symbol} {change:+.1f}%")

    chains = {str(balance["chain"]) for balance in balances if balance.get("chain")}
    score = min(10, len(balances) * 2 + len(chains))
    lines.extend(
        [
            "\n  3. DIVERSIFICATION",
            f"     Tokens held: {len(balances)}",
            f"     Chains used: {len(chains)} ({', '.join(sorted(chains))})",
            f"     Heuristic score: {score}/10",
        ]
    )

    stable_symbols = {"USDC", "USDT", "DAI"}
    stable_usd = sum(
        float(balance["usd_value"])
        for balance in balances
        if str(balance["symbol"]).upper() in stable_symbols
    )
    stable_pct = (stable_usd / total_usd) * 100
    lines.extend(
        [
            "\n  4. STABLECOIN RATIO",
            f"     Stablecoins: ${stable_usd:,.2f} ({stable_pct:.1f}%)",
        ]
    )
    if stable_pct < 10:
        lines.append(
            "     FLAG: Stablecoin allocation is below this example's 10% heuristic."
        )
        recommendations.append(
            {
                "action": "rebalance",
                "token": "USDC",
                "reason": "Stablecoin allocation below the example's 10% heuristic",
            }
        )
    elif stable_pct > 60:
        lines.append(
            "     FLAG: Stablecoin allocation is above this example's 60% heuristic."
        )

    lines.append("\n  5. RESEARCH FLAGS")
    if recommendations:
        for index, recommendation in enumerate(recommendations, 1):
            lines.append(
                f"     {index}. {recommendation['action'].upper()} "
                f"{recommendation['token']}: {recommendation['reason']}"
            )
    else:
        lines.append("     No heuristic flags triggered.")

    return "\n".join(lines), recommendations


def analyze_with_ai(
    portfolio: dict[str, Any],
    prices: dict[str, Any],
    chains: Any,
) -> str | None:
    prompt = f"""Analyze this crypto portfolio as a research exercise. Do not imply
that any trade has been approved or executed.

Portfolio:
{json.dumps(portfolio, indent=2)}

Prices:
{json.dumps(prices, indent=2)}

Supported chains:
{json.dumps(chains, indent=2)}

Discuss concentration, 24h moves, diversification, and stablecoin exposure.
Clearly label assumptions and research flags."""

    openai_key = os.environ.get("OPENAI_API_KEY")
    openai_model = os.environ.get("OPENAI_MODEL")
    if openai_key and openai_model:
        response = requests.post(
            "https://api.openai.com/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {openai_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": openai_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()["choices"][0]["message"]["content"]

    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    anthropic_model = os.environ.get("ANTHROPIC_MODEL")
    if anthropic_key and anthropic_model:
        response = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": anthropic_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json={
                "model": anthropic_model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        return response.json()["content"][0]["text"]

    return None


def verify_required_tools(tools: list[dict[str, Any]]) -> None:
    discovered = {
        str(tool.get("name"))
        for tool in tools
        if isinstance(tool, dict) and tool.get("name")
    }
    missing = ADVISOR_TOOL_ALLOWLIST - discovered
    if missing:
        raise RuntimeError(
            "Hosted MCP server is missing expected tools: " + ", ".join(sorted(missing))
        )


def render_catalog(client: McpClient) -> None:
    initialized = client.initialize()
    tools = client.list_tools()
    resources = client.list_resources()
    prompts = client.list_prompts()
    server = initialized.get("serverInfo", {})

    print(
        f"Connected to {server.get('name', 'unknown')} "
        f"v{server.get('version', 'unknown')} "
        f"(MCP {initialized.get('protocolVersion', 'unknown')})"
    )
    print(f"\nTools ({len(tools)}):")
    for tool in tools:
        annotations = tool.get("annotations", {}) if isinstance(tool, dict) else {}
        name = str(tool.get("name", "unknown"))
        if annotations.get("readOnlyHint") is True:
            hint = "read-only hint"
        elif name == "execute_swap":
            hint = "unsigned transaction preparation"
        else:
            hint = "inspect semantics"
        print(f"  - {name} [{hint}]")

    print(f"\nResources ({len(resources)}):")
    for resource in resources:
        print(f"  - {resource.get('uri', 'unknown')}")

    print(f"\nPrompts ({len(prompts)}):")
    for prompt in prompts:
        print(f"  - {prompt.get('name', 'unknown')}")

    print(
        "\nMCP annotations are descriptive hints, not authorization. "
        "Clients still need a local capability policy."
    )


def show_illustrative_quotes(
    client: McpClient,
    portfolio: dict[str, Any],
    recommendations: list[dict[str, str]],
) -> None:
    print(
        "\nIllustrative quotes (--quotes): get_quote is read-only; "
        "no transaction is prepared, signed, or broadcast."
    )
    balances = portfolio["balances"]

    for recommendation in recommendations:
        if recommendation["action"] != "sell":
            continue
        holding = next(
            (
                balance
                for balance in balances
                if balance["symbol"] == recommendation["token"]
            ),
            None,
        )
        if not holding or not holding.get("chain"):
            continue
        try:
            available = float(holding["balance"])
        except (TypeError, ValueError):
            continue
        if available <= 0:
            continue

        amount = min(available, 0.1)
        try:
            quote = call_advisor_tool(
                client,
                "get_quote",
                {
                    "from_token": recommendation["token"],
                    "to_token": "USDC",
                    "amount": str(amount),
                    "chain": holding["chain"],
                },
            )
            if isinstance(quote, dict):
                output = quote.get("to_amount", quote.get("amount_out", "?"))
            else:
                output = "?"
            print(
                f"  {amount} {recommendation['token']} → {output} USDC "
                f"on {holding['chain']}"
            )
        except Exception as exc:  # Example CLI: report quote failure and continue.
            print(f"  Quote unavailable for {recommendation['token']}: {exc}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Read-only Suwappu hosted-MCP portfolio advisor example"
    )
    parser.add_argument(
        "--catalog",
        action="store_true",
        help="inspect the public MCP tool/resource/prompt catalog; no API key required",
    )
    parser.add_argument(
        "--quotes",
        action="store_true",
        help="also request illustrative read-only get_quote results",
    )
    args = parser.parse_args()

    api_key = os.environ.get("SUWAPPU_API_KEY", "")
    client = McpClient(api_key)

    if args.catalog:
        render_catalog(client)
        return

    if not api_key:
        raise RuntimeError("SUWAPPU_API_KEY is required for portfolio analysis")

    wallet_address = os.environ.get("WALLET_ADDRESS", "")
    if not re.fullmatch(r"0x[a-fA-F0-9]{40}", wallet_address):
        raise RuntimeError(
            "WALLET_ADDRESS must be the authenticated agent's "
            "0x-prefixed managed EVM wallet"
        )

    initialized = client.initialize()
    tools = client.list_tools()
    verify_required_tools(tools)
    server = initialized.get("serverInfo", {})
    print(
        f"Connected to {server.get('name', 'unknown')} "
        f"v{server.get('version', 'unknown')}; discovered {len(tools)} tools."
    )
    print(
        "Advisor-local capability set: "
        + ", ".join(sorted(ADVISOR_TOOL_ALLOWLIST))
    )

    portfolio = parse_portfolio(
        call_advisor_tool(
            client,
            "get_portfolio",
            {"wallet_address": wallet_address},
        )
    )
    if not portfolio["balances"] or portfolio["total_usd"] <= 0:
        print("Portfolio has no positive balance valuation to analyze.")
        return

    print(f"\nPortfolio value: ${portfolio['total_usd']:,.2f}")
    for balance in portfolio["balances"]:
        pct = (balance["usd_value"] / portfolio["total_usd"]) * 100
        print(
            f"  {balance['symbol']:>6} | {balance['balance']:>12} | "
            f"${balance['usd_value']:>10,.2f} | {pct:>5.1f}%"
        )

    symbols = sorted({balance["symbol"] for balance in portfolio["balances"]})
    prices = parse_prices(
        call_advisor_tool(
            client,
            "get_prices",
            {"symbols": ",".join(symbols)},
        )
    )
    chains = call_advisor_tool(client, "list_chains")

    report, recommendations = rule_based_analysis(portfolio, prices)
    ai_result = analyze_with_ai(portfolio, prices, chains)
    if ai_result:
        print("\nAI research notes:\n")
        print(ai_result)
        print("\nHeuristic cross-check:\n")
    else:
        print(
            "\n(No AI provider + model configured — "
            "using the deterministic heuristic.)\n"
        )
    print(report)

    if args.quotes and recommendations:
        show_illustrative_quotes(client, portfolio, recommendations)

    print(
        "\nDone. This example never calls execute_swap "
        "and never submits managed execution."
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, requests.RequestException, ValueError) as exc:
        raise SystemExit(f"Error: {exc}") from exc
