/**
 * CoinMarketCap gives no unit or denomination for an RWA token. Most gold
 * tokens are 1 troy ounce (PAXG, XAUt), but some are 1 gram (CGO and VNXAU, judging by their prices).
 * Comparing their raw prices shows a fake 97% "depeg". This table converts a
 * token's price to the unit of its asset. Each entry cites its source.
 */
export const TROY_OUNCE_GRAMS = 31.1034768;

export const TOKEN_UNITS: Record<string, { per_token: string; to_asset_unit: number; source: string }> = {
  // Inferred from CoinMarketCap prices on 2026-11-16: price ratio to PAXG = 31.1 (grams per troy ounce).
  // To be confirmed on each issuer's terms page before the registry is published.
  CGO: { per_token: "1 gram of gold", to_asset_unit: TROY_OUNCE_GRAMS, source: "inferred: CMC price ratio 2026-11-16" },
  VNXAU: { per_token: "1 gram of gold", to_asset_unit: TROY_OUNCE_GRAMS, source: "inferred: CMC price ratio 2026-11-16" },
};

/** Price expressed per unit of the underlying asset. */
export function normalizedPrice(symbol: string, price: number): number {
  const u = TOKEN_UNITS[symbol.toUpperCase()];
  return u ? price * u.to_asset_unit : price;
}
