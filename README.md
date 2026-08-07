# suwappu-mcp-advisor

A builder-focused, read-only portfolio advisor for [Suwappu](https://suwappu.bot)'s hosted MCP server.

This repo is deliberately small enough to copy from. It shows modern MCP discovery, legacy fallback, structured tool results, local capability policy, portfolio/price reads, and optional read-only quotes without hiding custody boundaries. It also shows where an MCP demo should end and a sellable monitoring product can begin.

> Research example only — not financial advice. This program never calls `execute_swap` and never submits managed execution.

## What this example teaches

- Prefer stateless MCP `2026-07-28`: probe `server/discover`, send self-describing request `_meta`, and mirror the required `MCP-Protocol-Version` / `Mcp-Method` / `Mcp-Name` HTTP headers.
- Fall back to the `2025-06-18` `initialize` + `notifications/initialized` handshake when a legacy server rejects modern discovery.
- Accept both JSON and SSE Streamable HTTP responses and preserve an MCP session only on the legacy path.
- Require `resultType: "complete"` on modern responses; fail closed on multi-round `input_required` because this example does not need interactive MCP requests.
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

The TypeScript and Python files hand-roll the small amount of wire protocol on purpose so you can see the trust boundary. For a production client, prefer an official Tier 1 MCP SDK so protocol revisions and transport edge cases are maintained upstream: [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk) or [Python SDK](https://github.com/modelcontextprotocol/python-sdk). This example is the Suwappu-specific policy/product layer to keep even when you swap the transport implementation.

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

`--quotes` is still non-transactional: it calls `get_quote` only for a held asset that crossed the example's concentration threshold, with amount and chain grounded in the observed portfolio. A price drop in an unheld asset never becomes a buy instruction. The CLI never prepares, signs, or broadcasts a transaction.

## Builder pattern

A safe Suwappu MCP client has two policies: what the server advertises and what your application is allowed to use.

1. Negotiate the MCP era and discover the current catalog.
2. Intersect discovered capabilities with an application-owned allowlist.
3. Validate tool inputs from your own application context.
4. Treat tool-level `isError` as failure and prefer typed `structuredContent`.
5. Keep read-only research as the default.
6. Put transaction preparation or managed execution behind separate, explicit product decisions.

This repo implements those rules in both `src/mcp.ts` / `src/policy.ts` and `advisor.py`.

The heuristic deliberately emits research flags such as `reduce_concentration` and `review_liquidity`, not `buy` / `sell` orders. The thresholds are example policy inputs, not evidence that a trade is profitable or suitable.

## Turn the example into a product

The highest-value next step is usually not “make the advisor trade.” It is “make the evidence useful repeatedly.” See [BUILDING_A_PRODUCT.md](BUILDING_A_PRODUCT.md) for a concrete path from this CLI to paid monitoring, team workflows, approval handoffs, event records, unit economics, and retention metrics.

Keep two scorecards separate:

- **Builder economics:** subscription / usage revenue minus Suwappu credits, model calls, storage, notifications, and support.
- **Customer portfolio P&L:** an outcome of the customer's assets and decisions. Do not use it as your SaaS revenue or promise it as a return.

## Package/version boundary

The hosted MCP endpoint is the runtime source of truth.

Verified 2026-08-07:

- `@suwappu/sdk` on npm is `0.4.0`; newer `0.6.0` TypeScript SDK work exists in the core repository but is not the published npm package yet.
- `@suwappu/mcp-server` on npm is `0.1.1`; current `0.6.0` source is a forwarding stdio bridge to the hosted endpoint and is not published yet.
- The Python SDK is maintained in the Suwappu core repository and is not currently a PyPI release.

That is why this example talks directly to hosted MCP instead of pretending unpublished package versions are installable.

MCP itself has also moved quickly: `2026-07-28` is the current GA protocol revision. The client is dual-era so an upgraded hosted endpoint can use the modern stateless protocol without making the example stop working against a still-legacy deployment.

## Links

- [Suwappu](https://suwappu.bot)
- [Suwappu docs](https://docs.suwappu.bot)
- [Suwappu core](https://github.com/0xSoftBoi/suwappubot)
- [MCP 2026-07-28 specification](https://modelcontextprotocol.io/specification/2026-07-28)

## License

MIT
