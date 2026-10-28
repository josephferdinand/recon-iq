/** Browser-side resource shape only; server authorization remains authoritative. */
export type ResourceKey = string;
export interface Resource {
  key: ResourceKey;
  kind: string;
  tenantId: string;
  dependencies: ResourceKey[];
  [field: string]: unknown;
}
