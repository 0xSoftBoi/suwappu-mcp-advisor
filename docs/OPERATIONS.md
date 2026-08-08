# Operations Runbook

This runbook covers Suwappu MCP Advisor 2.x as a standalone **read-only** research service. The application allowlist is `get_portfolio`, `get_prices`, `list_chains`, and `get_quote`; it never calls unsigned transaction preparation or managed execution.

## Production contract

Server discovery answers what the MCP server offers. `ADVISOR_TOOL_ALLOWLIST` answers what this application may call. Treat those as separate controls in reviews and incidents.

Use distinct Suwappu/model-provider credentials per environment. Wallet addresses, portfolio state, generated research, and model prompts can be customer-sensitive even when no transaction occurs.

## Timeouts and failure semantics

TypeScript MCP and optional model-provider requests use `SUWAPPU_OPERATION_TIMEOUT_MS` (25s default, integer `100..30000`). Python keeps a fixed bounded request deadline. HTTP errors expose status without echoing raw non-2xx bodies.

Every allowed operation is read-only, so a timeout cannot directly duplicate a financial action. It can still duplicate cost or generated output. A hosted product should dedupe/suppress retries at the workflow layer and record whether facts were successfully persisted before invoking a model again.

## Evidence before prose

Persist normalized portfolio facts, price observations, policy version, deterministic flags, source protocol/tool versions, and observation time before generated commentary. Generated prose is a render of evidence, not the authoritative record.

When a model provider is unavailable, the deterministic heuristic remains a supported degraded mode. Track that state explicitly instead of silently presenting fallback text as model output.

## Cost and tenant isolation

Rate/budget MCP calls and model invocations independently. Cache shareable market data only where tenancy/privacy permits; never cache another customer's portfolio result into a shared key. Track contribution margin from product revenue minus Suwappu usage, model calls, storage/delivery/compute, payments, and attributable support.

## Container operation

The image runs as the unprivileged `bun` user and defaults to anonymous `--catalog`, so a container start cannot move funds or read a wallet.

```bash
docker build -t suwappu-mcp-advisor .
docker run --rm suwappu-mcp-advisor
```

Inject Suwappu/provider credentials only through the runtime secret mechanism for authenticated analysis.

## SLOs and alerts

Track MCP negotiation success, read/tool latency and error rate, missing-required-tool failures, deterministic analysis success, model-provider degraded-mode rate, quote-request rate, cost per retained customer, and attempts to call a tool outside the allowlist. Do not use customer portfolio performance as a service SLO.

## Incident order

1. Stop scheduled analyses/model calls and preserve sanitized workflow/evidence IDs.
2. Confirm the deployed allowlist and discovered server capabilities separately.
3. Determine whether deterministic facts were persisted before any failed model call/retry.
4. Rotate affected Suwappu/provider credentials when exposure is plausible.
5. Restore with anonymous catalog discovery, then one bounded deterministic analysis before normal cadence.

## Release gate

Every release must pass TypeScript typecheck/tests/build, Python transport/advisor tests, high/critical dependency audit, non-root container build, and CodeQL. Manually review the tool allowlist, MCP negotiation/fallback rules, timeout/error hygiene, evidence-vs-prose boundary, and product documentation.
