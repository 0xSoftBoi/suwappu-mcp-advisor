# suwappu-mcp-advisor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org)

AI-powered portfolio advisor using the [Suwappu](https://suwappu.bot) MCP protocol. Analyzes your crypto holdings and recommends trades.

> **Warning**: This is not financial advice. Always do your own research before trading.

## Features

- **Concentration risk** — warns when >50% in a single token
- **Momentum signals** — detects 24h price swings >5%
- **Diversification score** — rates portfolio spread across tokens and chains
- **Stablecoin ratio** — checks risk management allocation
- **AI analysis** — GPT-4o or Claude for detailed recommendations (optional)
- **Rule-based fallback** — works without any AI key

## Install

```bash
bun install        # TypeScript
pip install requests  # Python
```

## Usage

```bash
export SUWAPPU_API_KEY=suwappu_sk_...
export WALLET_ADDRESS=0xYourWallet

# Run with rule-based analysis
bun run src/advisor.ts

# Enable AI analysis (optional)
export OPENAI_API_KEY=sk-...       # GPT-4o
export ANTHROPIC_API_KEY=sk-ant-... # Claude

# Python
python advisor.py
```

## Example Output

```
Connected to suwappu v0.5.0
Protocol: 2024-11-05

Portfolio value: $48,250.75
   ETH |       12.500 | $43,755.25 | 90.7%
  USDC |     3,200.00 |  $3,200.00 |  6.6%

PORTFOLIO ADVISORY REPORT
  1. CONCENTRATION RISK
     WARNING: ETH is 90.7% of portfolio (>50%)
  2. RECOMMENDATIONS
     1. SELL ETH: Over-concentrated at 90.7%
```

## Links

- [Suwappu Docs](https://docs.suwappu.bot) | [MCP Protocol](https://docs.suwappu.bot/protocols/mcp)

## License

MIT
