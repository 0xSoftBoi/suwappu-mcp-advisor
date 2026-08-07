# From MCP example to a product people can pay for

The CLI proves a useful primitive: a client can discover Suwappu, read a portfolio and prices, apply its own policy, and optionally request a quote without crossing into transaction preparation or execution.

That is a good demo. A product needs a repeated job, evidence history, a delivery surface, and unit economics.

## Product ladder

| Stage | Customer job | What you add | Suwappu capability |
| --- | --- | --- | --- |
| Report | “What changed in this portfolio?” | One-shot summary with supporting observations | `get_portfolio`, `get_prices`, `list_chains` |
| Monitor | “Tell me when a condition becomes worth reviewing.” | Scheduled snapshots, deltas, thresholds, hysteresis, dedupe | Same read-only calls |
| Workspace | “Let my team review the evidence and decision history.” | Accounts, watchlists, alert states, notes, audit trail | Same reads; cache shared market data |
| Approval handoff | “Price an action I already chose to review.” | Explicit user intent, quote freshness, approval UI | `get_quote` |
| Execution product | “Carry out an approved action.” | Separate authorization, policy, custody, simulation, recovery | Out of scope here; design intentionally |

Do not make execution the default upgrade. A monitor that reliably suppresses noise can be more useful — and easier to trust — than an agent that produces more actions.

## Store evidence, not prose

LLM prose is a presentation layer. Persist a deterministic decision record first so alerts can be deduplicated, audited, and re-rendered later.

```json
{
  "schema_version": 1,
  "observed_at": "2026-08-07T12:00:00Z",
  "policy_version": "portfolio-monitor-v1",
  "facts": {
    "total_usd": 1000,
    "largest_position": { "symbol": "ETH", "share_pct": 90 },
    "stablecoin_share_pct": 10
  },
  "flags": [
    {
      "action": "reduce_concentration",
      "token": "ETH",
      "reason": "Held asset is 90.0% of observed portfolio value (>50% example threshold)"
    }
  ],
  "source": {
    "protocol": "2026-07-28",
    "tools": ["get_portfolio", "get_prices"]
  }
}
```

The action names above are workflow labels, not trade instructions. Keep the raw observations that caused each flag. Do not persist API keys. Minimize or pseudonymize wallet identifiers when a customer-facing audit record does not need the raw address.

## Make a monitor quiet enough to keep

A useful alert system has state. Compare each new record with the last accepted record and notify only when a condition changes materially.

For example:

- **Enter threshold:** concentration crosses above 50%.
- **Exit threshold:** do not clear it until it falls below 47%. This hysteresis prevents flapping around one boundary.
- **Deduplication:** do not resend an unchanged alert every poll.
- **Cooldown:** after notifying, suppress repeats until the state changes or a deliberate reminder window expires.
- **Evidence delta:** say what changed since the last accepted record, not merely what is true now.

The `50%`, `47%`, and stablecoin thresholds in this repository are example product-policy values. They are not investment research and should be configurable for the customer's use case.

## Unit economics before you choose a polling interval

As of 2026-08-07, Suwappu documents `get_portfolio`, `get_prices`, and `get_quote` at 1 credit each, with 1 credit approximately $0.001 on the pay-per-call path. Subscription tiers can bypass per-call metering, so query the live billing surface before making this a contractual price assumption. See the [Suwappu pricing docs](https://docs.suwappu.bot/billing/pricing).

For a monitor that makes one `get_portfolio` and one `get_prices` call per poll:

| Poll interval | Polls / 30-day month / wallet | Calls | Approx. pay-per-call Suwappu cost* |
| --- | ---: | ---: | ---: |
| 24 hours | 30 | 60 | $0.06 |
| 60 minutes | 720 | 1,440 | $1.44 |
| 15 minutes | 2,880 | 5,760 | $5.76 |

\*Illustrative arithmetic from the current documented credit value and tool weights, before subscription bypasses; pricing can change.

Do not poll every wallet at the fastest interval merely because you can. Let the customer value of freshness pay for the call rate.

Track builder economics separately from portfolio performance:

```text
monthly contribution margin
= customer subscription + usage revenue
- Suwappu usage / subscription cost
- model inference
- database + notifications + hosting
- payment fees + variable support
```

Customer trading or lending P&L does not belong in that formula.

## Where AI adds value

Keep deterministic facts and flags authoritative. Use an LLM to explain them, answer questions about them, or turn several facts into a readable briefing. That gives you three useful controls:

1. A model failure cannot invent the underlying portfolio state.
2. You can skip model calls when no state changed.
3. You can measure whether AI explanations improve engagement instead of assuming they do.

The example therefore works without an AI provider. That fallback is a product feature, not just a demo convenience.

## What to measure

The activation event should be closer to delivered value than “connected MCP.” A practical funnel is:

1. MCP connection succeeds.
2. First real portfolio snapshot succeeds.
3. First policy flag or all-clear record is stored.
4. First state change is delivered to the user.
5. User returns to inspect, acknowledge, or change a monitor.

Then measure alert precision proxies: dismissed alerts, duplicate suppression, time to acknowledgement, monitors retained after 7/30 days, and the fraction of model calls that correspond to a real state change.

## Hand-rolled protocol vs official SDK

This repository keeps the wire mechanics visible because it is a teaching example. MCP `2026-07-28` is a meaningful protocol break: modern requests are stateless and self-describing, while legacy clients use `initialize` sessions. The example handles both so the difference is concrete.

For a maintained product, use an official MCP SDK for transport and protocol negotiation:

- [TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Python SDK](https://github.com/modelcontextprotocol/python-sdk)

Keep the parts this repository adds on top: the Suwappu tool allowlist, input validation, result validation, evidence model, custody boundary, alert state machine, and product economics. Those are the pieces generic MCP SDK examples cannot decide for your business.

## Safe expansion checklist

Before adding transaction preparation or managed execution:

1. Make the new capability opt-in and separately authorized.
2. Validate asset, chain, amount, wallet, freshness, and policy limits from application-owned state.
3. Simulate where the execution path supports it.
4. Show a human-readable approval artifact before any signing or managed execution.
5. Record the approved intent separately from the observed market data.
6. Treat retries, expired quotes, partial failures, and duplicate requests as money-path failure modes.
7. Test with a disposable wallet and bounded amounts before production funds.

This advisor intentionally stops before that boundary.
