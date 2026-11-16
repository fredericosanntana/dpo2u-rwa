import { describe, it, expect } from "vitest";
import { CmcClient } from "../src/cmc/client.js";
import { loadPolicy } from "../src/policy.js";
import { evaluateToken, precheck, type Context } from "../src/engine.js";
import { snapshot, alertsFor } from "../src/monitor.js";
import { loadSanctions } from "../src/sanctions.js";
import type { IssuerRegistry } from "../src/registry/types.js";
import { sha256Canonical } from "../src/canonical.js";

// Real CoinMarketCap responses recorded on 2026-11-16 (test/fixtures/cmc).
const FIX = "test/fixtures/cmc";
const fixed = () => new Date("2026-11-16T14:00:00Z");

const registry: IssuerRegistry = {
  version: "test",
  reviewed_at: "2026-11-16",
  issuers: [
    {
      cmc_issuer_name: "Backed Assets",
      legal_entity: "Example Issuer Ltd",
      jurisdiction: "JE",
      regulator: "Example Regulator",
      licence: { type: "Prospectus approval", reference: "X-1", url: "https://example.org/licence" },
      custodian: null,
      sale_restrictions: [{ who: "US persons", countries: ["US"], source: "https://example.org/terms" }],
      products: ["xStocks"],
      confidence: "high",
      sources: ["https://example.org"],
      reviewed_at: "2026-11-16",
    },
  ],
};

async function ctx(country = "BR", withSanctions = false): Promise<Context> {
  const policy = await loadPolicy();
  return {
    policy: { ...policy, profile: { ...policy.profile, investor_country: country } },
    registry,
    sanctions: withSanctions ? await loadSanctions("test/fixtures/sanctions-sample.txt") : null,
    now: fixed,
  };
}

describe("precheck on real CMC responses", () => {
  it("returns one verdict per NVDA token and logs the API calls", async () => {
    const cmc = new CmcClient({ fixturesDir: FIX });
    const r = await precheck(cmc, await ctx(), ["NVDA"]);
    expect(r.verdicts.length).toBeGreaterThanOrEqual(3);
    expect(r.verdicts.map((v) => v.subject.token_symbol)).toContain("NVDAX");
    expect(r.api_calls.map((c) => c.endpoint)).toEqual(["/v5/real-world-assets/quotes/latest", "/v2/cryptocurrency/info"]);
    expect(r.credits_used).toBeGreaterThan(0);
  });

  it("reads contracts from cryptocurrency/info and removes duplicate EVM addresses", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx(), ["NVDA"], "NVDAX");
    const v = r.verdicts[0];
    const evm = v.subject.contracts.filter((c) => c.address.toLowerCase() === "0xc845b2894dbddd03858fd2d643b4ef725fe0849d");
    expect(new Set(evm.map((c) => c.chain)).size).toBe(evm.length);
    expect(v.subject.contracts.some((c) => c.chain === "Solana")).toBe(true);
  });

  it("a registered issuer passes identity and licence; BR retail is not barred by a US-only restriction", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx("BR", true), ["NVDA"], "NVDAX");
    const s = Object.fromEntries(r.verdicts[0].signals.map((x) => [x.id, x.status]));
    expect(s).toMatchObject({ issuer_identified: "pass", issuer_licence: "pass", sanctions: "pass", sale_restriction: "pass", liquidity: "pass" });
    expect(r.verdicts[0].outcome).toBe("meets");
  });

  it("the same token does not meet the policy for a US investor", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx("US", true), ["NVDA"], "NVDAX");
    expect(r.verdicts[0].outcome).toBe("does_not_meet");
    expect(r.verdicts[0].signals.find((s) => s.id === "sale_restriction")?.status).toBe("fail");
  });

  it("unknown issuers get attention, never a pass", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx(), ["NVDA"], "NVDAon");
    expect(r.verdicts[0].outcome).not.toBe("meets");
  });

  it("the digest covers the whole verdict", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx(), ["NVDA"], "NVDAX");
    const { digest, ...body } = r.verdicts[0];
    expect(digest).toBe(sha256Canonical(body));
  });
});

describe("signals", () => {
  const asset = {
    rwa_id: 1, name: "Test", symbol: "TST", slug: "t", asset_type: "stock" as const, rwa_rank: 1, has_tokens: true,
    average_tokenized_price: 100, tokenized_market_cap: 1, tokenized_volume_24h: 1, last_updated: "2026-11-16T00:00:00Z",
    tokens: [
      { symbol: "A", name: "A", price: 100, crypto_id: 1, issuer_id: null, issuer_name: "Backed Assets", market_cap: 1, volume_24h: 1e6 },
      { symbol: "B", name: "B", price: 100.5, crypto_id: 2, issuer_id: null, issuer_name: "Backed Assets", market_cap: 1, volume_24h: 1e6 },
      { symbol: "C", name: "C", price: 110, crypto_id: 3, issuer_id: null, issuer_name: "Backed Assets", market_cap: 1, volume_24h: 0 },
    ],
  };

  it("flags a token whose price drifts from its siblings", async () => {
    const v = evaluateToken(asset, asset.tokens[2], undefined, await ctx());
    expect(v.signals.find((s) => s.id === "price_consistency")?.status).toBe("fail");
    expect(v.signals.find((s) => s.id === "liquidity")?.status).toBe("fail");
    expect(v.outcome).toBe("does_not_meet");
  });

  it("a sanctioned contract address fails the sanctions check", async () => {
    const c = await ctx("BR", true);
    const info = { id: 1, name: "A", symbol: "A", slug: "a", contract_address: [{ contract_address: "0x8576ACC5C05D6CE88F4E49BF65BDF0C62F91353C", platform: { name: "Ethereum", coin: { id: "1027", symbol: "ETH" } } }] };
    const v = evaluateToken(asset, asset.tokens[0], info, c);
    expect(v.signals.find((s) => s.id === "sanctions")?.status).toBe("fail");
  });
});

describe("monitor snapshot", () => {
  it("builds the daily snapshot from list + quotes and raises alerts on change", async () => {
    const c = await ctx();
    const s = await snapshot(new CmcClient({ fixturesDir: FIX }), c, { types: ["stock", "etf", "commodity"] });
    expect(s.summary.tokens).toBe(s.summary.meets + s.summary.attention + s.summary.does_not_meet);
    expect(s.assets.length).toBeGreaterThan(0);
    const flipped = structuredClone(s);
    flipped.assets[0].verdicts[0].outcome = flipped.assets[0].verdicts[0].outcome === "meets" ? "attention" : "meets";
    const alerts = alertsFor(s.assets.flatMap((a) => a.verdicts), flipped);
    expect(alerts.some((a) => a.kind === "outcome_changed")).toBe(true);
  });
});

describe("units", () => {
  it("gram-denominated gold tokens compare with ounce tokens after normalization (real CMC prices)", async () => {
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), await ctx(), ["GOLD"]);
    const cgo = r.verdicts.find((v) => v.subject.token_symbol === "CGO");
    expect(cgo?.signals.find((s) => s.id === "price_consistency")?.status).toBe("pass");
  });
});

describe("curated registry (registry/issuers.json)", () => {
  it("Ondo Global Markets is barred for retail investors in Brazil, Robinhood stock tokens outside the EEA", async () => {
    const { loadRegistry } = await import("../src/registry/load.js");
    const c = { ...(await ctx("BR")), registry: await loadRegistry() };
    const r = await precheck(new CmcClient({ fixturesDir: FIX }), c, ["NVDA"]);
    const by = Object.fromEntries(r.verdicts.map((v) => [v.subject.token_symbol + "|" + v.subject.issuer_name, v]));
    expect(by["NVDAon|Ondo Assets"].signals.find((s) => s.id === "sale_restriction")?.status).toBe("fail");
    expect(by["NVDA|Robinhood"].signals.find((s) => s.id === "sale_restriction")?.status).toBe("fail");
    expect(by["NVDAX|Backed Assets"].signals.find((s) => s.id === "sale_restriction")?.status).toBe("pass");
  });

  it("every licence and restriction in the registry cites a source", async () => {
    const { loadRegistry } = await import("../src/registry/load.js");
    for (const i of (await loadRegistry()).issuers) {
      if (i.licence) expect(i.licence.url).toMatch(/^https:\/\//);
      for (const r of i.sale_restrictions ?? []) expect(r.source).toMatch(/^https:\/\//);
    }
  });
});
