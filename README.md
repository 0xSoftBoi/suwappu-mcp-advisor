# suwappu-mcp-advisor

AI-powered portfolio advisor using [Suwappu](https://suwappu.bot) MCP protocol.

## Quick Start

```bash
# Python
pip install requests && export SUWAPPU_API_KEY=suwappu_sk_... && export WALLET_ADDRESS=0x... && python advisor.py

# TypeScript
npm install && export SUWAPPU_API_KEY=suwappu_sk_... && export WALLET_ADDRESS=0x... && npx tsx advisor.ts
```

### Optional AI

```bash
export OPENAI_API_KEY=sk-...       # GPT-4o
export ANTHROPIC_API_KEY=sk-ant-... # Claude
```

Without AI keys, uses rule-based analysis.

## Analysis

- Concentration risk (>50% single token)
- Momentum signals (24h changes)
- Diversification score
- Stablecoin ratio
- Trade recommendations with quotes

[Docs](https://docs.suwappu.bot) | [MCP Protocol](https://docs.suwappu.bot/protocols/mcp)
