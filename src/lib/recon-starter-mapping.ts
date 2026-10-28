import type { StarterBinding } from "@/lib/recon-template-compiler";

export type StarterBindingProgress = {
  complete: boolean;
  mappedFields: number;
  requiredFieldCount: number;
  sides: Array<{ sourceSelected: boolean; mappedFields: number; complete: boolean }>;
};

/** Summarizes the exact leg and field requirements before a starter install. */
export function getStarterBindingProgress(
  legCount: number,
  requiredFields: string[],
  bindings: StarterBinding[],
  name: string,
): StarterBindingProgress {
  const sourceIds = bindings.slice(0, legCount).map((binding) => binding.data_source_id).filter(Boolean);
  const distinctSources = new Set(sourceIds);
  const sides = Array.from({ length: legCount }, (_, index) => {
    const binding = bindings[index];
    const mappedFields = requiredFields.filter((field) => Boolean(binding?.field_map[field])).length;
    const uniqueSource = Boolean(binding?.data_source_id) && distinctSources.has(binding.data_source_id)
      && sourceIds.filter((sourceId) => sourceId === binding.data_source_id).length === 1;
    return {
      sourceSelected: Boolean(binding?.data_source_id),
      mappedFields,
      complete: uniqueSource && mappedFields === requiredFields.length,
    };
  });
  return {
    complete: name.trim().length >= 2
      && bindings.length === legCount
      && sides.every((side) => side.complete)
      && distinctSources.size === legCount,
    mappedFields: sides.reduce((total, side) => total + side.mappedFields, 0),
    requiredFieldCount: legCount * requiredFields.length,
    sides,
  };
}
