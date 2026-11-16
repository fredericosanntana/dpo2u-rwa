import { createHash } from "node:crypto";

/** JSON with sorted keys and no whitespace: same input, same bytes, same digest. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
    .join(",")}}`;
}

export function sha256Canonical(v: unknown): string {
  return createHash("sha256").update(canonicalJson(v)).digest("hex");
}
