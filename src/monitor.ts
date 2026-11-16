import type { CmcClient } from "./cmc/client.js";
import type { AssetType, RwaQuote } from "./cmc/types.js";
import { evaluateToken, type Context, type Outcome, type TokenVerdict } from "./engine.js";

export const SNAPSHOT_FORMAT = "dpo2u.rwa-monitor/0";

export interface Alert {
  kind: "outcome_changed" | "price_deviation" | "no_trading" | "new_token";
  token_symbol: string;
  rwa_symbol: string;
  message: string;
  from?: Outcome;
  to?: Outcome;
}

export interface MonitorSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  generated_at: string;
  policy: TokenVerdict["policy"];
  profile: TokenVerdict["profile"];
  summary: { assets: number; tokens: number; meets: number; attention: number; does_not_meet: number; by_signal: Record<string, Record<string, number>> };
  assets: Array<{ rwa_symbol: string; rwa_name: string; asset_type: string; tokenized_market_cap: number | null; verdicts: TokenVerdict[] }>;
  alerts: Alert[];
  api_calls: CmcClient["calls"];
  credits_used: number;
  disclaimer: string;
  limitations: string[];
}

export interface MonitorOptions {
  types?: AssetType[];
  perType?: number;
  previous?: MonitorSnapshot | null;
}

/**
 * Daily snapshot for the public page: the top assets of each type, every
 * token checked against the reference policy, plus alerts against yesterday.
 * Cost with the defaults: 3 list calls + 1 quotes call + 1-2 crypto info calls.
 */
export async function snapshot(cmc: CmcClient, ctx: Context, opts: MonitorOptions = {}): Promise<MonitorSnapshot> {
  const types = opts.types ?? ["stock", "etf", "commodity"];
  const perType = opts.perType ?? 25;
  const listed: RwaQuote[] = [];
  for (const t of types) listed.push(...(await cmc.list(t, perType)));
  // CMC returned one BRK.B entry with rwa_id null on 2026-11-16; skip entries without an id.
  const withTokens = listed.filter((a) => a.has_tokens !== false && typeof a.rwa_id === "number");
  const ids = new Set(withTokens.map((a) => a.rwa_id));
  const quotes = (await cmc.quotesById([...ids])).filter((q) => ids.has(q.rwa_id));
  const tokens = quotes.flatMap((a) => (a.tokens ?? []).filter((t) => t.issuer_name !== "NA (Derivatives)").map((t) => ({ a, t })));
  const infos = await cmc.cryptoInfo([...new Set(tokens.map((x) => x.t.crypto_id))]);

  const byAsset = new Map<string, MonitorSnapshot["assets"][number]>();
  for (const { a, t } of tokens) {
    const v = evaluateToken(a, t, infos[String(t.crypto_id)], ctx);
    const row = byAsset.get(a.symbol) ?? {
      rwa_symbol: a.symbol,
      rwa_name: a.name,
      asset_type: a.asset_type,
      tokenized_market_cap: a.tokenized_market_cap,
      verdicts: [],
    };
    row.verdicts.push(v);
    byAsset.set(a.symbol, row);
  }
  const assets = [...byAsset.values()].sort((x, y) => (y.tokenized_market_cap ?? 0) - (x.tokenized_market_cap ?? 0));
  const all = assets.flatMap((a) => a.verdicts);
  const by_signal: Record<string, Record<string, number>> = {};
  for (const v of all) for (const s of v.signals) {
    by_signal[s.id] ??= { pass: 0, warn: 0, fail: 0 };
    by_signal[s.id][s.status]++;
  }
  return {
    format: SNAPSHOT_FORMAT,
    generated_at: (ctx.now ?? (() => new Date()))().toISOString(),
    policy: { id: ctx.policy.id, version: ctx.policy.version, hash: ctx.policy.hash },
    profile: ctx.policy.profile,
    summary: {
      assets: assets.length,
      tokens: all.length,
      meets: all.filter((v) => v.outcome === "meets").length,
      attention: all.filter((v) => v.outcome === "attention").length,
      does_not_meet: all.filter((v) => v.outcome === "does_not_meet").length,
      by_signal,
    },
    assets,
    alerts: alertsFor(all, opts.previous ?? null),
    api_calls: cmc.calls,
    credits_used: cmc.creditsUsed(),
    disclaimer: ctx.policy.disclaimer,
    limitations: ctx.policy.limitations ?? [],
  };
}

export function alertsFor(current: TokenVerdict[], previous: MonitorSnapshot | null): Alert[] {
  const alerts: Alert[] = [];
  const prev = new Map<string, TokenVerdict>();
  for (const a of previous?.assets ?? []) for (const v of a.verdicts) prev.set(key(v), v);
  for (const v of current) {
    const p = prev.get(key(v));
    const base = { token_symbol: v.subject.token_symbol, rwa_symbol: v.subject.rwa_symbol };
    if (previous && !p) alerts.push({ ...base, kind: "new_token", message: `New token ${v.subject.token_symbol} (${v.subject.issuer_name ?? "unknown issuer"}) for ${v.subject.rwa_name}.` });
    if (p && p.outcome !== v.outcome) alerts.push({ ...base, kind: "outcome_changed", from: p.outcome, to: v.outcome, message: `${v.subject.token_symbol} moved from "${p.outcome}" to "${v.outcome}".` });
    const price = v.signals.find((s) => s.id === "price_consistency");
    if (price && price.status !== "pass" && price.evidence) alerts.push({ ...base, kind: "price_deviation", message: `${v.subject.token_symbol}: ${price.detail}` });
    const liq = v.signals.find((s) => s.id === "liquidity");
    if (liq?.status === "fail") alerts.push({ ...base, kind: "no_trading", message: `${v.subject.token_symbol}: no trading in the last 24h.` });
  }
  return alerts;
}

const key = (v: TokenVerdict) => `${v.subject.rwa_symbol}:${v.subject.crypto_id}`;
