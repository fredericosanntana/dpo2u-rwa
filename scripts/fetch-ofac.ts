/**
 * Build a sanctions list file from the US Treasury OFAC SDN list:
 * entity names plus every "Digital Currency Address" in the remarks.
 *   npx tsx scripts/fetch-ofac.ts > data/sanctions/ofac-sdn.txt
 * Then: SANCTIONS_FILE=data/sanctions/ofac-sdn.txt
 */
const URL_SDN = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV";

const res = await fetch(URL_SDN);
if (!res.ok) throw new Error(`OFAC download failed: ${res.status}`);
const csv = await res.text();
const names = new Set<string>();
const addresses = new Set<string>();
for (const line of csv.split(/\r?\n/)) {
  const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "")) ?? [];
  const [, name, type] = cols;
  // Column 3 is the SDN type: "-0-" marks an entity (companies, the kind of name an issuer has).
  if (name && type?.trim() === "-0-") names.add(name.trim());
  for (const m of line.matchAll(/Digital Currency Address - [A-Z0-9]+ ([0-9A-Za-z]+)/g)) addresses.add(m[1]);
}
console.log(`# OFAC SDN (entities + digital currency addresses), fetched ${new Date().toISOString()} from ${URL_SDN}`);
for (const n of [...names].sort()) console.log(n);
for (const a of [...addresses].sort()) console.log(a);
