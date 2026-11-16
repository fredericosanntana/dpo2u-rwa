import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { IssuerRecord, IssuerRegistry } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REGISTRY = join(here, "..", "..", "registry", "issuers.json");

export async function loadRegistry(path = process.env.RWA_REGISTRY_FILE ?? DEFAULT_REGISTRY): Promise<IssuerRegistry> {
  return JSON.parse(await readFile(path, "utf8")) as IssuerRegistry;
}

export function findIssuer(reg: IssuerRegistry, cmcName: string | null | undefined): IssuerRecord | undefined {
  if (!cmcName) return undefined;
  const n = norm(cmcName);
  return reg.issuers.find((i) => norm(i.cmc_issuer_name) === n);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
