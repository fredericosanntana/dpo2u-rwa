import type { RwaQuote, RwaToken, CryptoInfo } from "./cmc/types.js";
import type { IssuerRecord } from "./registry/types.js";
import type { Policy } from "./policy.js";
import type { ScreenResult } from "./sanctions.js";
import { normalizedPrice, TOKEN_UNITS } from "./units.js";

export type SignalStatus = "pass" | "warn" | "fail";

export interface Signal {
  id: string;
  status: SignalStatus;
  detail: string;
  evidence?: Record<string, unknown>;
  sources?: string[];
}

export interface Contract {
  chain: string;
  address: string;
}

export function contractsOf(info: CryptoInfo | undefined): Contract[] {
  if (!info) return [];
  const out: Contract[] = (info.contract_address ?? []).map((c) => ({
    chain: c.platform?.name ?? "unknown",
    address: c.contract_address,
  }));
  if (out.length === 0 && info.platform?.token_address) {
    out.push({ chain: info.platform.name, address: info.platform.token_address });
  }
  // CMC repeats EVM addresses across chains, sometimes checksum-cased.
  const seen = new Set<string>();
  return out.filter((c) => {
    const k = `${c.chain}:${c.address.startsWith("0x") ? c.address.toLowerCase() : c.address}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

export function issuerIdentified(token: RwaToken, rec: IssuerRecord | undefined): Signal {
  if (!token.issuer_name) {
    return { id: "issuer_identified", status: "fail", detail: "CoinMarketCap returns no issuer for this token." };
  }
  if (!rec || !rec.legal_entity) {
    return {
      id: "issuer_identified",
      status: "warn",
      detail: `Issuer "${token.issuer_name}" is listed by CoinMarketCap but not yet in the DPO2U issuer registry.`,
      evidence: { issuer_name: token.issuer_name },
    };
  }
  if (!rec.jurisdiction) {
    return {
      id: "issuer_identified",
      status: "warn",
      detail: `${rec.legal_entity}: jurisdiction not found in primary sources.`,
      evidence: { legal_entity: rec.legal_entity },
      sources: rec.sources,
    };
  }
  return {
    id: "issuer_identified",
    status: "pass",
    detail: `${rec.legal_entity} (${rec.jurisdiction}).`,
    evidence: { legal_entity: rec.legal_entity, jurisdiction: rec.jurisdiction },
    sources: rec.sources,
  };
}

export function issuerLicence(rec: IssuerRecord | undefined): Signal {
  const l = rec?.licence;
  if (l?.status === "revoked" || l?.status === "suspended") {
    return { id: "issuer_licence", status: "fail", detail: `Licence ${l.status}.`, evidence: { ...l }, sources: l.url ? [l.url] : [] };
  }
  if (!l || !l.url) {
    return { id: "issuer_licence", status: "warn", detail: "No licence or registration found in primary sources." };
  }
  return {
    id: "issuer_licence",
    status: "pass",
    detail: [rec?.regulator, l.type, l.reference].filter(Boolean).join(" · "),
    evidence: { regulator: rec?.regulator, ...l },
    sources: [l.url],
  };
}

export function sanctions(result: ScreenResult): Signal {
  switch (result.status) {
    case "not_screened":
      return { id: "sanctions", status: "warn", detail: "No sanctions list loaded; not screened." };
    case "match":
      return { id: "sanctions", status: "fail", detail: `Match on sanctions list: ${result.matches.join(", ")}.`, evidence: { matches: result.matches } };
    case "clear":
      return { id: "sanctions", status: "pass", detail: `No match (${result.checked.length} names and addresses screened).`, evidence: { checked: result.checked } };
  }
}

export function saleRestriction(rec: IssuerRecord | undefined, profile: Policy["profile"]): Signal {
  if (!rec || rec.sale_restrictions === null || rec.sale_restrictions === undefined) {
    return { id: "sale_restriction", status: "warn", detail: "Offer terms not found." };
  }
  const country = profile.investor_country.toUpperCase();
  const hits = rec.sale_restrictions.filter((r) => {
    const byCountry = r.countries?.some((c) => c === "*" || c.toUpperCase() === country) ?? false;
    const byType = r.investor_types?.includes(profile.investor_type) ?? false;
    const notAllowed = r.only_countries ? !r.only_countries.map((c) => c.toUpperCase()).includes(country) : false;
    // A restriction naming both countries and investor types bars only that combination.
    if (r.countries?.length && r.investor_types?.length) return byCountry && byType;
    return byCountry || byType || notAllowed;
  });
  if (hits.length) {
    return {
      id: "sale_restriction",
      status: "fail",
      detail: `Barred for ${profile.investor_type} investors in ${country}: ${hits.map((h) => h.who).join("; ")}.`,
      evidence: { restrictions: hits },
      sources: hits.map((h) => h.source),
    };
  }
  if (rec.sale_terms_complete === false) {
    return {
      id: "sale_restriction",
      status: "warn",
      detail: `No restriction found for ${profile.investor_type} investors in ${country}, but the issuer's full eligibility terms were not captured.`,
      evidence: { restrictions_checked: rec.sale_restrictions.length },
      sources: rec.sale_restrictions.map((r) => r.source),
    };
  }
  return {
    id: "sale_restriction",
    status: "pass",
    detail: `No restriction found for ${profile.investor_type} investors in ${country}.`,
    evidence: { restrictions_checked: rec.sale_restrictions.length },
    sources: rec.sale_restrictions.map((r) => r.source),
  };
}

export function liquidity(token: RwaToken, t: Policy["thresholds"]): Signal {
  if (token.volume_24h == null) {
    return { id: "liquidity", status: "warn", detail: "CoinMarketCap has no 24h volume for this token.", evidence: { volume_24h_usd: null } };
  }
  const v = token.volume_24h;
  const evidence = { volume_24h_usd: v, min_volume_24h_usd: t.min_volume_24h_usd };
  if (v <= 0) return { id: "liquidity", status: "fail", detail: "No trading in the last 24h.", evidence };
  if (v < t.min_volume_24h_usd) return { id: "liquidity", status: "warn", detail: `24h volume ${usd(v)} is below ${usd(t.min_volume_24h_usd)}.`, evidence };
  return { id: "liquidity", status: "pass", detail: `24h volume ${usd(v)}.`, evidence };
}

/**
 * Compares the token's price with the median price of all tokens of the same
 * real-world asset (e.g. NVDAx vs NVDAon vs other NVDA tokens). A token that
 * drifts away from its siblings is a depeg or a stale market.
 */
export function priceConsistency(token: RwaToken, asset: RwaQuote, t: Policy["thresholds"]): Signal {
  const prices = (asset.tokens ?? [])
    .filter((x) => typeof x.price === "number" && x.price > 0)
    .map((x) => normalizedPrice(x.symbol, x.price as number));
  if (token.price == null || prices.length < 2) {
    return { id: "price_consistency", status: "warn", detail: "Not enough price data to compare." };
  }
  return scored(token.symbol, normalizedPrice(token.symbol, token.price), median(prices), `median of ${prices.length} tokens`, t);
}

/** Above this gap the prices are almost surely in different units, not a depeg. */
const NOT_COMPARABLE = 0.5;

function scored(symbol: string, price: number, ref: number, refLabel: string, t: Policy["thresholds"]): Signal {
  const dev = Math.abs(price - ref) / ref;
  const unit = TOKEN_UNITS[symbol.toUpperCase()];
  const evidence = { price_per_asset_unit: price, reference: ref, reference_kind: refLabel, deviation: round(dev, 4), unit: unit?.per_token };
  const pct = `${(dev * 100).toFixed(2)}%`;
  if (dev >= NOT_COMPARABLE) {
    return { id: "price_consistency", status: "warn", detail: `Price ${pct} away from the ${refLabel}: the token likely uses a different unit; not comparable until its unit is registered.`, evidence };
  }
  if (dev >= t.price_deviation_fail) return { id: "price_consistency", status: "fail", detail: `Price ${pct} away from the ${refLabel}.`, evidence };
  if (dev >= t.price_deviation_warn) return { id: "price_consistency", status: "warn", detail: `Price ${pct} away from the ${refLabel}.`, evidence };
  return { id: "price_consistency", status: "pass", detail: `Price within ${pct} of the ${refLabel}.`, evidence };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
const usd = (x: number) => `US$ ${Math.round(x).toLocaleString("en-US")}`;
