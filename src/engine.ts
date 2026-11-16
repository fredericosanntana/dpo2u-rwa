import type { CmcClient } from "./cmc/client.js";
import type { CryptoInfo, RwaQuote, RwaToken } from "./cmc/types.js";
import type { IssuerRegistry } from "./registry/types.js";
import { findIssuer } from "./registry/load.js";
import type { Policy } from "./policy.js";
import { screen, type SanctionsList } from "./sanctions.js";
import * as sig from "./signals.js";
import { sha256Canonical } from "./canonical.js";

export const VERDICT_FORMAT = "dpo2u.rwa-verdict/0";

export type Outcome = "meets" | "attention" | "does_not_meet";

export interface TokenVerdict {
  format: typeof VERDICT_FORMAT;
  policy: { id: string; version: string; hash: string };
  profile: Policy["profile"];
  subject: {
    rwa_symbol: string;
    rwa_name: string;
    rwa_id: number;
    asset_type: string;
    token_symbol: string;
    token_name: string;
    crypto_id: number;
    issuer_name: string | null;
    contracts: sig.Contract[];
  };
  outcome: Outcome;
  signals: sig.Signal[];
  market: { price: number | null; volume_24h: number | null; market_cap: number | null; as_of: string };
  data_source: "CoinMarketCap Pro API";
  evaluated_at: string;
  disclaimer: string;
  digest: string;
}

export interface Context {
  policy: Policy & { hash: string };
  registry: IssuerRegistry;
  sanctions: SanctionsList | null;
  now?: () => Date;
}

/** Issuer names CMC uses for things that are not an issuer of record. */
const NON_ISSUERS = new Set(["NA (Derivatives)"]);

export function evaluateToken(asset: RwaQuote, token: RwaToken, info: CryptoInfo | undefined, ctx: Context): TokenVerdict {
  const rec = findIssuer(ctx.registry, token.issuer_name);
  const contracts = sig.contractsOf(info);
  const signals: sig.Signal[] = [
    sig.issuerIdentified(token, rec),
    sig.issuerLicence(rec),
    sig.sanctions(screen(ctx.sanctions, [token.issuer_name, rec?.legal_entity], contracts.map((c) => c.address))),
    sig.saleRestriction(rec, ctx.policy.profile),
    sig.liquidity(token, ctx.policy.thresholds),
    sig.priceConsistency(token, asset, ctx.policy.thresholds),
  ];
  const outcome: Outcome = signals.some((s) => s.status === "fail")
    ? "does_not_meet"
    : signals.some((s) => s.status === "warn")
      ? "attention"
      : "meets";
  const body: Omit<TokenVerdict, "digest"> = {
    format: VERDICT_FORMAT,
    policy: { id: ctx.policy.id, version: ctx.policy.version, hash: ctx.policy.hash },
    profile: ctx.policy.profile,
    subject: {
      rwa_symbol: asset.symbol,
      rwa_name: asset.name,
      rwa_id: asset.rwa_id,
      asset_type: asset.asset_type,
      token_symbol: token.symbol,
      token_name: token.name,
      crypto_id: token.crypto_id,
      issuer_name: token.issuer_name,
      contracts,
    },
    outcome,
    signals,
    market: { price: token.price, volume_24h: token.volume_24h, market_cap: token.market_cap, as_of: asset.last_updated },
    data_source: "CoinMarketCap Pro API",
    evaluated_at: (ctx.now ?? (() => new Date()))().toISOString(),
    disclaimer: ctx.policy.disclaimer,
  };
  return { ...body, digest: sha256Canonical(body) };
}

export interface PrecheckResult {
  query: { symbols: string[]; token?: string };
  verdicts: TokenVerdict[];
  not_found: string[];
  api_calls: CmcClient["calls"];
  credits_used: number;
}

/**
 * Check every token of the given real-world assets (or one token by symbol).
 * Two to three CMC calls: quotes/latest, then cryptocurrency/info for contracts.
 */
export async function precheck(cmc: CmcClient, ctx: Context, symbols: string[], tokenSymbol?: string): Promise<PrecheckResult> {
  const wanted = new Set(symbols.map((s) => s.toUpperCase()));
  const assets = (await cmc.quotes([...wanted])).filter((a) => wanted.has(a.symbol.toUpperCase()));
  const found = new Set(assets.map((a) => a.symbol.toUpperCase()));
  const pairs = assets.flatMap((a) =>
    (a.tokens ?? [])
      .filter((t) => !NON_ISSUERS.has(t.issuer_name ?? ""))
      .filter((t) => !tokenSymbol || t.symbol.toUpperCase() === tokenSymbol.toUpperCase())
      .map((t) => ({ a, t })),
  );
  const infos = await cmc.cryptoInfo([...new Set(pairs.map((p) => p.t.crypto_id))]);
  const verdicts = pairs.map(({ a, t }) => evaluateToken(a, t, infos[String(t.crypto_id)], ctx));
  return {
    query: { symbols, token: tokenSymbol },
    verdicts,
    not_found: symbols.filter((s) => !found.has(s.toUpperCase())),
    api_calls: cmc.calls,
    credits_used: cmc.creditsUsed(),
  };
}
