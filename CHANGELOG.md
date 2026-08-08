# Changelog

All notable changes to this repository are documented here.

## 2.0.0 — 2026-08-07

### Added

- bounded MCP/model-provider operation deadlines;
- compiled CLI, high-severity dependency audit, non-root container, and CodeQL gates;
- operations and contributor runbooks.

### Changed

- TypeScript/Python client identity is now 2.0.0;
- non-2xx MCP/provider errors no longer copy raw upstream response bodies into operator errors;
- CI installs from the lockfile and verifies the distributable/container;
- the local read-only allowlist remains the explicit production authority boundary.

## 1.2.0

- MCP 2026-07-28 discovery with 2025-06-18 fallback, typed result handling, local tool policy, and product-economics guidance.
