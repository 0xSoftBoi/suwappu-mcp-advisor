# Security Policy

This repository is a satellite / example application built on the
[Suwappu API](https://github.com/0xSoftBoi/suwappubot). This advisor is
intentionally non-transactional: it reads portfolio / market data and can request
an illustrative `get_quote` only when `--quotes` is explicit. It never calls
`execute_swap`, never signs or broadcasts a transaction, and never calls the
managed execution API. Treat API keys, wallet identifiers, and configuration as
sensitive anyway.

## Reporting a vulnerability

**Do not open a public issue for security reports.** Instead:

- Use **GitHub Private Vulnerability Reporting** when it is enabled for this repository, or
- Email **security@suwappu.bot**.

Please include the affected file, version or commit, reproduction steps, and an
impact assessment.

**Scope note:** issues in this repository's own code, SDK usage, dependencies,
or CI belong here. Vulnerabilities in the Suwappu API, core bot, smart
contracts, custody/key-management layer, or shared SDK should be reported
upstream through the
[core security policy](https://github.com/0xSoftBoi/suwappubot/security/policy).

## Capability and custody boundary

The local allowlist is the security boundary for this example. Discovery and MCP
tool annotations describe server capabilities but do not authorize this client
to use them. The allowlist contains `get_portfolio`, `get_prices`, `list_chains`,
and `get_quote` only.

Suwappu exposes transaction preparation and managed execution elsewhere, but
adding either to a fork is a new money-path capability. Review its custody,
authorization, simulation, retry/idempotency, and approval design separately;
do not infer that this repository's read-only safety properties still apply.

Never commit credentials. Use least-privilege API keys and disposable test
wallets when experimenting with a fork that adds any execution capability.

## Our commitment

- **Acknowledge** reports within 3 business days.
- **Triage and severity** within 7 business days.
- **Coordinate disclosure** with the reporter and provide credit unless
  anonymity is requested.

## Safe harbor

Good-faith research conducted under this policy, without privacy violations,
data destruction, or service degradation, will not result in legal action from
us. If in doubt, contact us before testing.
