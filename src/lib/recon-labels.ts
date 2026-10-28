export const RECON_TYPE_LABELS = {
  one_sided: "Single Side Reconciliation",
  two_sided: "Two-Sided Reconciliation",
  three_sided: "Tri-Party Reconciliation",
} as const;

export type ReconType = keyof typeof RECON_TYPE_LABELS;

export function reconTypeLabel(value: string) {
  return RECON_TYPE_LABELS[value as ReconType] ?? value;
}
