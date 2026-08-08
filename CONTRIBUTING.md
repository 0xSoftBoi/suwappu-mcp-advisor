# Contributing

Thanks for improving the Suwappu MCP Advisor. Its security boundary is the application-owned read-only allowlist. Do not add `execute_swap`, managed execution, signing, or another money-moving capability as an incidental advisor feature.

## Development

Requires Bun 1.3.14+ and Python 3.12+ for the companion implementation.

```bash
npm ci
bun run verify
python -m py_compile advisor.py
python -m unittest discover -s tests -p 'test_*.py'
```

Protocol tests should use fake transport responses. They must not spend credits or touch funds.

## Pull-request bar

A change is ready when it:

- preserves the local advisor allowlist and read-only custody boundary;
- treats discovery/annotations as metadata rather than authorization;
- fails closed on malformed MCP/tool results and unsupported multi-round requests;
- bounds MCP/provider calls and does not log credentials or raw non-2xx upstream bodies;
- preserves modern/legacy MCP negotiation tests when transport code changes;
- keeps deterministic evidence/flags authoritative over generated prose;
- updates `README.md`, `BUILDING_A_PRODUCT.md`, and `docs/OPERATIONS.md` when product/operations semantics change;
- passes TypeScript typecheck/tests/build/audit, Python tests, container build, and CodeQL.

## Security

Do not put vulnerability details in a public issue. Follow [SECURITY.md](SECURITY.md).
