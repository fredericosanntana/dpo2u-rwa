import { readFile } from "node:fs/promises";

/**
 * Sanctions screening against a plain list (one entry per line: an entity
 * name or a 0x/base58 address; lines starting with # are comments).
 * DPO2U production loads its consolidated list here; the same list root is
 * used by the in-circuit non-membership proof on Midnight.
 */
export interface SanctionsList {
  source: string;
  loaded_at: string;
  names: Set<string>;
  addresses: Set<string>;
}

export async function loadSanctions(path = process.env.SANCTIONS_FILE): Promise<SanctionsList | null> {
  if (!path) return null;
  const text = await readFile(path, "utf8");
  const names = new Set<string>();
  const addresses = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (/^(0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}|T[1-9A-HJ-NP-Za-km-z]{33})$/.test(line)) {
      addresses.add(line.toLowerCase());
    } else {
      names.add(normName(line));
    }
  }
  return { source: path, loaded_at: new Date().toISOString(), names, addresses };
}

export type ScreenResult =
  | { status: "not_screened" }
  | { status: "clear"; checked: string[] }
  | { status: "match"; matches: string[] };

export function screen(list: SanctionsList | null, names: (string | null | undefined)[], addresses: string[]): ScreenResult {
  if (!list) return { status: "not_screened" };
  const matches: string[] = [];
  const checked: string[] = [];
  for (const n of names) {
    if (!n) continue;
    checked.push(n);
    if (list.names.has(normName(n))) matches.push(n);
  }
  for (const a of addresses) {
    checked.push(a);
    if (list.addresses.has(a.toLowerCase())) matches.push(a);
  }
  return matches.length ? { status: "match", matches } : { status: "clear", checked };
}

const normName = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(ltd|limited|inc|llc|ag|sa|plc|corp|corporation|gmbh|uab|co)\b\.?/g, "")
    .replace(/[^a-z0-9]/g, "");
