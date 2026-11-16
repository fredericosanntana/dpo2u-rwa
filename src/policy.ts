import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sha256Canonical } from "./canonical.js";

export interface Policy {
  id: string;
  version: string;
  title: string;
  profile: { client: string; investor_type: string; investor_country: string };
  thresholds: { min_volume_24h_usd: number; price_deviation_warn: number; price_deviation_fail: number };
  outcomes: { pass: string; warn: string; fail: string };
  criteria: Array<{ id: string; title: string; pass: string; warn: string; fail: string }>;
  disclaimer: string;
  limitations?: string[];
}

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_POLICY = join(here, "..", "policy", "reference-v0.json");

export async function loadPolicy(path: string = process.env.RWA_POLICY_FILE ?? DEFAULT_POLICY): Promise<Policy & { hash: string }> {
  const p = JSON.parse(await readFile(path, "utf8")) as Policy;
  return { ...p, hash: sha256Canonical(p) };
}
