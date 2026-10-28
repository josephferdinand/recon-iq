import { TRANSFORM_BY_KIND } from "@/lib/data-prep-transforms";

export type DataPrepEditorIssue = { controlId: string; message: string };
/** Client completeness feedback. Server validation and current access remain authoritative. */
export function dataPrepEditorIssues(draft: any): DataPrepEditorIssue[] {
  const issues: DataPrepEditorIssue[] = [];
  const add = (controlId: string, message: string) => issues.push({ controlId, message });
  if (typeof draft.name !== "string" || draft.name.trim().length < 2 || draft.name.length > 120) add("data-prep-pipeline-name", "Enter a pipeline name with 2–120 characters.");
  if (draft.description != null && (typeof draft.description !== "string" || draft.description.length > 1000)) add("data-prep-pipeline-description", "Keep the description within 1000 characters.");
  if (!Array.isArray(draft.steps) || draft.steps.length > 100) add("data-prep-add-step", "Use at most 100 transformation steps.");
  for (const [index, step] of (Array.isArray(draft.steps) ? draft.steps : []).entries()) {
    const definition = TRANSFORM_BY_KIND[step.kind];
    if (!definition) { add(`data-prep-step-${index}-kind`, `Choose a supported transformation for step ${index + 1}.`); continue; }
    for (const parameter of definition.params) {
      const value = step[parameter.name] ?? step.params?.[parameter.name];
      const id = `data-prep-step-${index}-${parameter.name}`;
      const missing = value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
      if (parameter.required && missing) { add(id, `Step ${index + 1}: ${parameter.label} is required.`); continue; }
      if (missing) continue;
      if (parameter.kind === "number" && (typeof value !== "number" || !Number.isFinite(value))) add(id, `Step ${index + 1}: enter a finite number for ${parameter.label}.`);
      if (parameter.kind === "csv" && (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim()))) add(id, `Step ${index + 1}: enter a non-empty field list for ${parameter.label}.`);
      if (parameter.kind === "select" && !parameter.options.includes(String(value))) add(id, `Step ${index + 1}: choose a supported ${parameter.label}.`);
    }
  }
  if (!Array.isArray(draft.dq_rules) || draft.dq_rules.length > 50) add("data-prep-add-rule", "Use at most 50 quality rules.");
  for (const [index, rule] of (Array.isArray(draft.dq_rules) ? draft.dq_rules : []).entries()) {
    if (typeof rule.id !== "string" || !rule.id.length || rule.id.length > 64) add(`data-prep-rule-${index}-id`, `Rule ${index + 1}: enter an ID within 64 characters.`);
    if (typeof rule.field !== "string" || !rule.field.length || rule.field.length > 120) add(`data-prep-rule-${index}-field`, `Rule ${index + 1}: enter a field within 120 characters.`);
    if (rule.kind === "regex" && (typeof rule.params?.pattern !== "string" || !rule.params.pattern.length)) add(`data-prep-rule-${index}-pattern`, `Rule ${index + 1}: a regex pattern is required.`);
    if (["min", "max"].includes(rule.kind) && (typeof rule.params?.value !== "number" || !Number.isFinite(rule.params.value))) add(`data-prep-rule-${index}-limit`, `Rule ${index + 1}: a finite numeric limit is required.`);
    if (rule.kind === "in_set" && (!Array.isArray(rule.params?.values) || !rule.params.values.length || rule.params.values.length > 1000)) add(`data-prep-rule-${index}-values`, `Rule ${index + 1}: enter 1–1000 allowed values.`);
  }
  return issues;
}
