# suwappu-mcp-advisor

A builder-focused, read-only portfolio advisor for [Suwappu](https://suwappu.bot)'s hosted MCP server.

This repo is deliberately small enough to copy from. It shows the MCP handshake, discovery, structured tool results, local capability policy, portfolio/price reads, and optional read-only quotes without hiding custody boundaries.

> Research example only — not financial advice. This program never calls `execute_swap` and never submits managed execution.

## What this example teaches

- Connect to `https://api.suwappu.bot/mcp` with MCP `2025-06-18`.
- Send `initialize` with client metadata, then `notifications/initialized`.
- Accept both JSON and SSE Streamable HTTP responses and preserve an MCP session when the server issues one.
- Discover tools, resources, and prompts instead of hard-coding the server version.
- Treat MCP `annotations` as descriptive hints, not authorization.
- Apply a local tool allowlist before every tool call.
- Prefer `structuredContent` and fail closed when a tool result has `isError: true`.
- Keep read-only research, unsigned transaction preparation, and managed execution as separate capabilities.

The advisor's own allowlist is intentionally narrower than the server catalog:

```text
get_portfolio
get_prices
list_chains
get_quote
```

`get_quote` is only called when you explicitly pass `--quotes`.

## Hosted MCP surface

The hosted server currently exposes 22 tools. Discovery is the source of truth, so builders should still call `tools/list` at runtime.

| Area | Tools | Capability |
| --- | --- | --- |
| Core data & discovery | `get_quote`, `get_portfolio`, `get_prices`, `list_chains`, `list_tokens`, `get_tempo_tokens`, `browse_mpp_directory` | Read-only |
| Simulation | `simulate_swap` | Read-only simulation; no broadcast |
| Transaction preparation | `execute_swap` | Builds an unsigned self-custody transaction |
| Predictions | `predict_markets`, `predict_market`, `predict_book`, `predict_price`, `predict_trades` | Read-only |
| Perps | `perps_markets`, `perps_quote`, `perps_positions` | Read-only |
| Lending | `lend_markets`, `lend_market` | Read-only |
| Swap observability | `get_swap_status`, `get_swap_history` | Read-only |
| Policy | `list_wallet_policies` | Read-only |

The MCP method catalog also includes resources and prompts. Use `resources/list` / `resources/read` and `prompts/list` / `prompts/get` rather than assuming names or URIs.

### Public discovery

You can perform the MCP handshake and discovery without an API key. The following tool calls are also public:

- `list_chains`
- `list_tokens`
- `get_tempo_tokens`
- `browse_mpp_directory`

Portfolio, price, quote, and account-specific data paths should be used with your Suwappu API key.

Run the catalog viewer anonymously:

```bash
bun run src/advisor.ts --catalog
# or
python advisor.py --catalog
```

### Important custody distinction

MCP `execute_swap` does **not** mean “trade now.” It prepares an unsigned self-custody transaction for the caller to review and sign.

Managed execution is a different REST capability: `POST /v1/agent/swap/execute`. Do not silently substitute one for the other in an agent integration.

This advisor calls neither one.

## Install

TypeScript/Bun:

```bash
bun install
bun run check
bun test
```

Python:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Configure

Copy the values you need from `.env.example`:

```bash
export SUWAPPU_API_KEY=suwappu_sk_...
export WALLET_ADDRESS=0xYourManagedEvmWallet
```

`WALLET_ADDRESS` is required for portfolio analysis. `--catalog` does not require either value.

Optional AI research notes require a provider key **and** an explicit model id:

```bash
export OPENAI_API_KEY=...
export OPENAI_MODEL=...
# or
export ANTHROPIC_API_KEY=...
export ANTHROPIC_MODEL=...
```

If neither provider+model pair is configured, the example uses its deterministic heuristic.

## Run

```bash
# Read portfolio/prices/chains and produce research flags.
bun run src/advisor.ts

# Also request illustrative, read-only quotes.
bun run src/advisor.ts --quotes

# Python parity.
python advisor.py
python advisor.py --quotes
```

`--quotes` is still non-transactional: it calls `get_quote` only for amounts and chains grounded in the portfolio. It never prepares, signs, or broadcasts a transaction.

## Builder pattern

A safe Suwappu MCP client has two policies: what the server advertises and what your application is allowed to use.

1. Initialize MCP and discover the current catalog.
2. Intersect discovered capabilities with an application-owned allowlist.
3. Validate tool inputs from your own application context.
4. Treat tool-level `isError` as failure and prefer typed `structuredContent`.
5. Keep read-only research as the default.
6. Put transaction preparation or managed execution behind separate, explicit product decisions.

This repo implements those rules in both `src/mcp.ts` / `src/policy.ts` and `advisor.py`.

## Package/version boundary

The hosted MCP endpoint is the runtime source of truth.

As of this repo update:

- `@suwappu/sdk` on npm is `0.4.0`; newer `0.6.0` TypeScript SDK work exists in the core repository but is not the published npm package yet.
- `@suwappu/mcp-server` on npm is `0.1.1`; current `0.6.0` source is a forwarding stdio bridge to the hosted endpoint and is not published yet.
- The Python SDK is maintained in the Suwappu core repository and is not currently a PyPI release.

That is why this example talks directly to hosted MCP instead of pretending unpublished package versions are installable.

## Links

- [Suwappu](https://suwappu.bot)
- [Suwappu docs](https://docs.suwappu.bot)
- [Suwappu core](https://github.com/0xSoftBoi/suwappubot)

## License

MIT
