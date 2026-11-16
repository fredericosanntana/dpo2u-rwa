#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { CmcClient } from "./cmc/client.js";
import { defaultContext } from "./context.js";
import { precheck } from "./engine.js";
import { findIssuer, loadRegistry } from "./registry/load.js";

/**
 * MCP server. The tool an agent calls before it buys, accepts or lists a
 * tokenized asset. In DPO2U production the same tool sits behind the x402
 * gateway (pay per verdict in USDC on Stellar); here it runs locally.
 */
export function buildServer() {
  const server = new McpServer({ name: "dpo2u-rwa", version: "0.1.0" });

  server.registerTool(
    "rwa_precheck",
    {
      title: "Tokenized asset compliance pre-check",
      description:
        "Before buying, accepting or listing a tokenized real-world asset (tokenized stock, ETF or commodity), check each token of it against the DPO2U reference policy: issuer identity, licence, sanctions, sale restrictions for the investor's country, liquidity and price consistency. Uses live CoinMarketCap data. Returns one verdict per token: meets, attention or does_not_meet, with evidence, sources and a digest.",
      inputSchema: {
        symbols: z.array(z.string()).min(1).max(20).describe("Real-world asset symbols as CoinMarketCap lists them, e.g. NVDA, SPY, GOLD"),
        token: z.string().optional().describe("Only this token, e.g. NVDAX or PAXG"),
        investor_country: z.string().length(2).optional().describe("ISO-3166 alpha-2 country of the investor (default BR)"),
      },
    },
    async ({ symbols, token, investor_country }) => {
      const ctx = await defaultContext({ investorCountry: investor_country });
      const r = await precheck(new CmcClient(), ctx, symbols, token);
      const lines = r.verdicts.map((v) => `${v.subject.token_symbol} (${v.subject.issuer_name ?? "?"}): ${v.outcome}`);
      return {
        content: [
          { type: "text", text: `${lines.join("\n") || "No tokens found."}\n\n${ctx.policy.disclaimer}` },
          { type: "text", text: JSON.stringify(r) },
        ],
      };
    },
  );

  server.registerTool(
    "rwa_issuer",
    {
      title: "Tokenized asset issuer sheet",
      description: "Return the DPO2U registry record of an RWA issuer (legal entity, jurisdiction, regulator, licence, custodian, sale restrictions, sources).",
      inputSchema: { issuer_name: z.string().describe("Issuer name as CoinMarketCap shows it, e.g. Backed Assets, Ondo Assets, Paxos") },
    },
    async ({ issuer_name }) => {
      const rec = findIssuer(await loadRegistry(), issuer_name);
      return { content: [{ type: "text", text: rec ? JSON.stringify(rec, null, 2) : `Issuer "${issuer_name}" is not in the registry yet.` }] };
    },
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildServer().connect(new StdioServerTransport());
}
