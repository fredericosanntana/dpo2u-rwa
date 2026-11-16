import { loadPolicy } from "./policy.js";
import { loadRegistry } from "./registry/load.js";
import { loadSanctions } from "./sanctions.js";
import type { Context } from "./engine.js";

export async function defaultContext(overrides: { investorCountry?: string; investorType?: string } = {}): Promise<Context> {
  const policy = await loadPolicy();
  if (overrides.investorCountry) policy.profile = { ...policy.profile, investor_country: overrides.investorCountry.toUpperCase() };
  if (overrides.investorType) policy.profile = { ...policy.profile, investor_type: overrides.investorType };
  return { policy, registry: await loadRegistry(), sanctions: await loadSanctions() };
}
