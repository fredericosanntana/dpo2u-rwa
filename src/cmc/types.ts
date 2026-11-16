// Shapes of the CoinMarketCap Pro API responses this module reads.
// Field names follow https://coinmarketcap.com/api/documentation/pro-api-reference/real-world-assets
// Only the fields we use are typed; everything else is kept as unknown.

export type AssetType =
  | "stock"
  | "commodity"
  | "currency"
  | "government_security"
  | "etf"
  | "real_estate";

export interface CmcStatus {
  timestamp: string;
  error_code: number | string;
  error_message: string | null;
  elapsed?: number;
  credit_count: number;
  notice?: string | null;
  total_count?: number;
}

export interface CmcEnvelope<T> {
  data: T;
  status: CmcStatus;
}

export interface RwaToken {
  symbol: string;
  name: string;
  price: number | null;
  crypto_id: number;
  issuer_id: string | null;
  issuer_name: string | null;
  market_cap: number | null;
  volume_24h: number | null;
}

export interface TradfiMarket {
  exchange: { slug: string; name: string; exchange_id: number };
  ticker: string;
  market_url?: string;
}

export interface RwaQuote {
  rwa_id: number;
  name: string;
  symbol: string;
  slug: string;
  asset_type: AssetType;
  rwa_rank: number | null;
  has_tokens: boolean;
  average_tokenized_price: number | null;
  tokenized_market_cap: number | null;
  tokenized_volume_24h: number | null;
  last_updated: string;
  tokens?: RwaToken[];
  tradfi_markets?: TradfiMarket[];
}

export interface RwaInfo {
  rwa_id: number;
  name: string;
  symbol: string;
  slug: string;
  asset_type: AssetType;
  website?: string | null;
  cik?: string | null;
  industry?: string | null;
  primary_exchange?: string | null;
  about?: { description?: string; website?: string; date_added?: string };
}

export interface Issuer {
  issuer_id: string;
  name: string;
  website: string | null;
  logo?: string | null;
  num_tokens: number;
}

export interface CryptoInfo {
  id: number;
  name: string;
  symbol: string;
  slug: string;
  platform?: { id: number | string; name: string; slug: string; symbol: string; token_address: string } | null;
  contract_address?: Array<{
    contract_address: string;
    platform: { name: string; coin: { id: string; name?: string; symbol: string; slug?: string } };
  }>;
  urls?: Record<string, string[]>;
}
