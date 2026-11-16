# dpo2u-rwa

**Compliance pre-checks for tokenized real-world assets, on live CoinMarketCap data.**

CoinMarketCap now lists about 7,800 tokenized stocks, ETFs and commodities from 25 issuers. NVIDIA alone has eight tokens: Backed's xStock, Ondo, Robinhood, Dinari, Coinbase, bStocks, Reality and more. The data shows *what* trades. A bank, a VASP or an AI agent still has to answer a different question before it buys, accepts or lists one of them:

> *Can I offer this token to this client, in this country, today?*

`dpo2u-rwa` answers that per token, against a **published reference policy**, with evidence and sources:

| Signal | What it checks | Data |
| --- | --- | --- |
| `issuer_identified` | Legal entity and jurisdiction behind the token | CMC `issuer_name` + DPO2U issuer registry |
| `issuer_licence` | Licence, registration or prospectus approval, with the regulator's link | DPO2U issuer registry |
| `sanctions` | Issuer and every contract address against a sanctions list | CMC `/v2/cryptocurrency/info` contracts + OFAC SDN |
| `sale_restriction` | Is the sale barred for this investor type and country (e.g. US persons) | DPO2U issuer registry |
| `liquidity` | 24h volume of the token | CMC `quotes/latest` |
| `price_consistency` | Token price vs the median of all tokens of the same asset (depeg or stale market) | CMC `quotes/latest` |

Each token gets one outcome, **meets**, **attention** or **does not meet** the policy, plus a SHA-256 digest of the canonical verdict so it can be anchored on-chain and audited later.

> Due-diligence signals against a published reference policy. Not legal advice, not an investment recommendation and not a rating.

Part of [DPO2U](https://dpo2u.com), compliance as a protocol for institutions and the machine economy.

## Quick start

```bash
npm install
cp .env.example .env            # put your own CMC_API_KEY there; never commit it
export $(grep -v '^#' .env | xargs)
npx tsx src/cli.ts check NVDA GOLD --country BR
```

No key? Replay the real responses recorded on 2026-11-16:

```bash
CMC_FIXTURES_DIR=test/fixtures/cmc npx tsx src/cli.ts check NVDA
```

### Use it from an AI agent (MCP)

```bash
npx tsx src/mcp.ts      # stdio MCP server
```

Tools: `rwa_precheck(symbols, token?, investor_country?)` and `rwa_issuer(issuer_name)`. In DPO2U production the same tool sits behind an x402 paywall (pay per verdict in USDC on Stellar).

### Daily monitor

```bash
npx tsx src/cli.ts snapshot --out snapshots/latest.json
```

Builds the snapshot behind the public page: the top assets of each type, every token checked, a summary by signal, and alerts against the previous day (outcome changed, price deviation, no trading, new token). About 5 credits per run.

## CoinMarketCap endpoints used

| Endpoint | Used for | Credits |
| --- | --- | --- |
| `GET /v5/real-world-assets/quotes/latest` | Tokens of each asset, issuer, price, volume, market cap | 1 per 250 assets |
| `GET /v5/real-world-assets/assets/list` | Top assets per type for the monitor | 1 per 250 assets |
| `GET /v5/real-world-assets/map` | Coverage per asset type | 0 |
| `GET /v5/real-world-assets/issuers/list` | Issuer universe for the registry | 1 |
| `GET /v5/real-world-assets/info` | Asset metadata (CIK, exchange) | 1 per 250 assets |
| `GET /v2/cryptocurrency/info` | Contract addresses and chains of each token (for sanctions screening) | 1 per 100 ids |

### Evidence of real API calls

`test/fixtures/cmc/` holds raw responses from real calls made on 2026-11-16 (status blocks with `credit_count` included, no key). Every verdict also lists the exact calls behind it (`api_calls`, `credits_used`).

## What the API made possible, and where it got in the way

**Made possible:** one call returns every token of an asset across issuers, which is exactly what a compliance check needs (the same NVIDIA exposure from eight issuers under different rules). `issuer_name` on each token, plus `crypto_id` linking into the regular crypto endpoints, gave us contracts and chains for sanctions screening without another provider.

**Got in the way:**
- **No unit or denomination per token.** CGO and VNXAU (1 gram of gold) trade at about 1/31 of PAXG and XAUt (1 troy ounce). Comparing raw prices shows a fake 97% "depeg". We keep a unit table; a `unit` field would fix it at the source.
- **No issuer jurisdiction, regulator, licence or sale restrictions.** The issuer object has name, website and logo only. This is the core of RWA compliance, so we curate it ourselves (`registry/`).
- **No contract addresses on RWA tokens.** We need a second call to `/v2/cryptocurrency/info`.
- **`government_security`, `currency` and `real_estate` return zero assets today**, although they are in the enum. Tokenized treasuries (the asset banks ask about first) are not covered yet.
- `market-pairs/list` is not on the Startup plan, so per-venue checks are out of reach during the event.

## Layout

```
src/cmc/        CoinMarketCap client (live or fixtures) and types
src/signals.ts  the six signals
src/engine.ts   per-token verdict and precheck()
src/monitor.ts  daily snapshot and alerts
src/mcp.ts      MCP server
policy/         reference policy (versioned; the verdict carries its hash)
registry/       curated issuer registry, every fact with a source URL
scripts/        OFAC SDN list builder
```

## License

Apache-2.0
