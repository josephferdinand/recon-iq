export type IncidentFunctionRegistration = { cell_key: string; component_key: string; function_key: string; function_label: string; availability: string };
/** Common registrations for every selected cell; never guess region/function
 * mappings or silently discard a stored historical selection. */
export function incidentFunctionOptions(registrations: IncidentFunctionRegistration[], cells: string[], components: string[], selected: string[]) {
  const choices = new Map<string, { key: string; label: string; available: boolean }>();
  if (cells.length && components.length) for (const item of registrations) {
    if (!cells.includes(item.cell_key) || !components.includes(item.component_key)) continue;
    if (cells.every((cell) => registrations.some((entry) => entry.cell_key === cell && entry.function_key === item.function_key && components.includes(entry.component_key)))) {
      choices.set(item.function_key, { key: item.function_key, label: item.function_label, available: true });
    }
  }
  for (const key of selected) if (!choices.has(key)) choices.set(key, { key, label: `${key} — not registered across the selected scope`, available: false });
  return [...choices.values()].sort((a, b) => a.label.localeCompare(b.label));
}
