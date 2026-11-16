import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CmcEnvelope, CryptoInfo, Issuer, RwaInfo, RwaQuote, AssetType } from "./types.js";

const BASE = "https://pro-api.coinmarketcap.com";

export interface CallRecord {
  endpoint: string;
  query: Record<string, string>;
  credit_count: number;
  timestamp: string;
}

export interface CmcClientOptions {
  apiKey?: string;
  /** Read recorded responses from this folder instead of the network. */
  fixturesDir?: string;
  /** Map an endpoint + query to a fixture file name. */
  fixtureName?: (endpoint: string, query: Record<string, string>) => string;
  fetchImpl?: typeof fetch;
}

/**
 * Thin client for the CoinMarketCap RWA endpoints.
 * Every call is logged (endpoint, query, credit_count) so a verdict can show
 * exactly which API calls produced it.
 */
export class CmcClient {
  readonly calls: CallRecord[] = [];
  private readonly key?: string;
  private readonly fixturesDir?: string;
  private readonly fixtureName: (e: string, q: Record<string, string>) => string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CmcClientOptions = {}) {
    this.key = opts.apiKey ?? process.env.CMC_API_KEY;
    this.fixturesDir = opts.fixturesDir ?? process.env.CMC_FIXTURES_DIR;
    this.fixtureName = opts.fixtureName ?? defaultFixtureName;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    if (!this.key && !this.fixturesDir) {
      throw new Error("Set CMC_API_KEY (or CMC_FIXTURES_DIR to replay recorded responses).");
    }
  }

  async get<T>(endpoint: string, query: Record<string, string> = {}): Promise<CmcEnvelope<T>> {
    let body: CmcEnvelope<T>;
    if (this.fixturesDir) {
      const file = join(this.fixturesDir, this.fixtureName(endpoint, query));
      body = JSON.parse(await readFile(file, "utf8")) as CmcEnvelope<T>;
    } else {
      const url = new URL(endpoint, BASE);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      const res = await this.fetchImpl(url, {
        headers: { "X-CMC_PRO_API_KEY": this.key!, Accept: "application/json" },
      });
      body = (await res.json()) as CmcEnvelope<T>;
      if (!res.ok || Number(body?.status?.error_code ?? 0) !== 0) {
        throw new CmcError(endpoint, res.status, body?.status?.error_message ?? res.statusText);
      }
    }
    this.calls.push({
      endpoint,
      query,
      credit_count: body.status?.credit_count ?? 0,
      timestamp: body.status?.timestamp ?? new Date().toISOString(),
    });
    return body;
  }

  /** Quotes with underlying tokens and TradFi markets. 1 credit per 250 assets. */
  async quotes(symbols: string[]): Promise<RwaQuote[]> {
    const r = await this.get<{ rwa_assets: RwaQuote[] } | Record<string, RwaQuote>>(
      "/v5/real-world-assets/quotes/latest",
      { symbol: symbols.join(",") },
    );
    return normalizeAssets(r.data);
  }

  async info(symbols: string[]): Promise<RwaInfo[]> {
    const r = await this.get<{ rwa_assets: RwaInfo[] } | Record<string, RwaInfo>>(
      "/v5/real-world-assets/info",
      { symbol: symbols.join(",") },
    );
    return normalizeAssets(r.data);
  }

  async list(assetType: AssetType, limit = 50): Promise<RwaQuote[]> {
    const r = await this.get<{ rwa_assets: RwaQuote[] }>("/v5/real-world-assets/assets/list", {
      asset_type: assetType,
      limit: String(limit),
      sort: "rwa_rank",
    });
    return normalizeAssets(r.data);
  }

  async issuers(): Promise<Issuer[]> {
    const r = await this.get<{ issuers: Issuer[] }>("/v5/real-world-assets/issuers/list", { limit: "100" });
    return r.data.issuers ?? [];
  }

  /** Contract addresses and chains for token crypto_ids (general crypto endpoint). */
  async cryptoInfo(ids: number[]): Promise<Record<string, CryptoInfo>> {
    const out: Record<string, CryptoInfo> = {};
    for (let i = 0; i < ids.length; i += 100) {
      const r = await this.get<Record<string, CryptoInfo | CryptoInfo[]>>("/v2/cryptocurrency/info", {
        id: ids.slice(i, i + 100).join(","),
      });
      for (const [k, v] of Object.entries(r.data ?? {})) out[k] = Array.isArray(v) ? v[0] : v;
    }
    return out;
  }

  creditsUsed(): number {
    return this.calls.reduce((s, c) => s + c.credit_count, 0);
  }
}

export class CmcError extends Error {
  constructor(readonly endpoint: string, readonly httpStatus: number, message: string) {
    super(`CMC ${endpoint} failed (${httpStatus}): ${message}`);
  }
}

function normalizeAssets<T>(data: unknown): T[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as T[];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.rwa_assets)) return d.rwa_assets as T[];
  // Some CMC endpoints key results by symbol or id.
  return Object.values(d).flatMap((v) => (Array.isArray(v) ? v : [v])) as T[];
}

function defaultFixtureName(endpoint: string, query: Record<string, string>): string {
  if (endpoint.endsWith("/quotes/latest")) return "quotes-latest.json";
  if (endpoint.endsWith("/info") && endpoint.includes("real-world-assets")) return "info.json";
  if (endpoint.endsWith("/assets/list")) return `assets-list-${query.asset_type}.json`;
  if (endpoint.endsWith("/issuers/list")) return "issuers-list.json";
  if (endpoint.endsWith("/cryptocurrency/info")) return "crypto-info.json";
  if (endpoint.endsWith("/issuers")) return `issuer-${query.issuer_id}.json`;
  throw new Error(`No fixture mapping for ${endpoint}`);
}
