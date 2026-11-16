/** A curated record about an RWA issuer. Every non-null fact carries a source URL. */
export interface IssuerRecord {
  /** Issuer name exactly as CoinMarketCap returns it in tokens[].issuer_name */
  cmc_issuer_name: string;
  legal_entity: string | null;
  /** ISO-3166 alpha-2 */
  jurisdiction: string | null;
  regulator: string | null;
  licence: { type: string | null; reference: string | null; url: string | null; status?: "active" | "revoked" | "suspended" } | null;
  custodian: string | null;
  sale_restrictions: SaleRestriction[] | null;
  products: string[];
  confidence: "high" | "medium" | "low";
  notes?: string;
  sources: string[];
  reviewed_at: string;
}

export interface SaleRestriction {
  /** Plain words, as the source puts it */
  who: string;
  /** ISO-3166 alpha-2 countries barred; "*" for all countries */
  countries?: string[];
  /** Investor types barred, e.g. "retail" */
  investor_types?: string[];
  /** Countries where the offer is ONLY allowed (allow-list). */
  only_countries?: string[];
  source: string;
}

export interface IssuerRegistry {
  version: string;
  reviewed_at: string;
  issuers: IssuerRecord[];
}
