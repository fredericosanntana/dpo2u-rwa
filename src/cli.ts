#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { CmcClient } from "./cmc/client.js";
import { defaultContext } from "./context.js";
import { precheck } from "./engine.js";
import { snapshot, type MonitorSnapshot } from "./monitor.js";

const USAGE = `dpo2u-rwa: compliance signals for tokenized real-world assets (CoinMarketCap data)

  dpo2u-rwa check <RWA symbol...> [--token NVDAX] [--country BR] [--json]
  dpo2u-rwa snapshot [--out snapshots/latest.json] [--per-type 25]

Env: CMC_API_KEY (or CMC_FIXTURES_DIR), SANCTIONS_FILE (optional)`;

const LABEL = { meets: "MEETS", attention: "ATTENTION", does_not_meet: "DOES NOT MEET" } as const;
const MARK = { pass: "ok ", warn: "!! ", fail: "XX " } as const;

async function main(argv: string[]) {
  const [cmd, ...rest] = argv;
  const flags = parseFlags(rest);
  if (cmd === "check" && flags._.length) {
    const ctx = await defaultContext({ investorCountry: flags.country });
    const r = await precheck(new CmcClient(), ctx, flags._, flags.token);
    if (flags.json) return console.log(JSON.stringify(r, null, 2));
    console.log(`Policy ${ctx.policy.id}@${ctx.policy.version} · profile ${ctx.policy.profile.investor_type} investor in ${ctx.policy.profile.investor_country}\n`);
    for (const v of r.verdicts) {
      console.log(`${v.subject.token_symbol} (${v.subject.issuer_name ?? "?"}) for ${v.subject.rwa_symbol}: ${LABEL[v.outcome]}`);
      for (const s of v.signals) console.log(`   ${MARK[s.status]}${s.id}: ${s.detail}`);
      console.log(`   digest ${v.digest}\n`);
    }
    if (r.not_found.length) console.log(`Not found on CoinMarketCap: ${r.not_found.join(", ")}`);
    console.log(`CMC calls: ${r.api_calls.map((c) => c.endpoint).join(", ")} · credits ${r.credits_used}`);
    console.log(`\n${ctx.policy.disclaimer}`);
    return;
  }
  if (cmd === "snapshot") {
    const out = flags.out ?? "snapshots/latest.json";
    const previous = await readFile(out, "utf8").then((t) => JSON.parse(t) as MonitorSnapshot).catch(() => null);
    const ctx = await defaultContext({ investorCountry: flags.country });
    const s = await snapshot(new CmcClient(), ctx, { perType: flags["per-type"] ? Number(flags["per-type"]) : undefined, previous });
    await mkdir(dirname(out), { recursive: true });
    if (previous) await writeFile(out.replace(/\.json$/, `.${previous.generated_at.slice(0, 10)}.json`), JSON.stringify(previous));
    await writeFile(out, JSON.stringify(s, null, 2));
    console.log(`${s.summary.tokens} tokens of ${s.summary.assets} assets: ${s.summary.meets} meet, ${s.summary.attention} attention, ${s.summary.does_not_meet} do not meet. ${s.alerts.length} alerts. ${s.credits_used} credits. Wrote ${out}`);
    return;
  }
  console.log(USAGE);
  process.exitCode = cmd ? 1 : 0;
}

function parseFlags(args: string[]) {
  const opts: Record<string, string | undefined> = {};
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") opts.json = "1";
    else if (a.startsWith("--")) opts[a.slice(2)] = args[++i];
    else positional.push(a);
  }
  return Object.assign(opts, { _: positional }) as Record<string, string | undefined> & { _: string[] };
}

main(process.argv.slice(2)).catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
