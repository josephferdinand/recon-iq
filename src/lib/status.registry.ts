/**
 * The release handover identifies these two deployed environments. No region
 * is asserted because the current evidence does not identify infrastructure
 * geography. Add UAT/staging only from a verified environment registry.
 */
export const STATUS_ENVIRONMENTS = [
  { key: "production", label: "Production", registered: true, region: null, source: "verified-release" },
  { key: "development", label: "Development", registered: true, region: null, source: "verified-release" },
] as const;

export type StatusEnvironmentKey = (typeof STATUS_ENVIRONMENTS)[number]["key"];

export function getRegisteredStatusEnvironments() {
  return STATUS_ENVIRONMENTS.filter((environment) => environment.registered);
}

export function getUnregisteredEnvironmentChoices() {
  return ["UAT", "Staging"].map((label) => ({ label, registered: false as const }));
}
