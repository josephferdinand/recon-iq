import type { ReconSpec, RuleKind } from "@/lib/recon-engine";

export interface StarterTemplate {
  code: string;
  legs: Array<{ name?: string }>;
  keys: string[];
  rules: Array<Record<string, unknown>>;
  tolerances: Record<string, unknown>;
  sample_fields: string[];
}

export interface StarterBinding {
  data_source_id: string;
  field_map: Record<string, string>;
}

const SIDE_IDS = ["A", "B", "C"];

function fieldName(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function fieldsFromRule(rule: Record<string, unknown>): string[] {
  const many = Array.isArray(rule.fields) ? rule.fields.map(fieldName).filter(Boolean) as string[] : [];
  const one = fieldName(rule.field);
  return one ? [...many, one] : many;
}

function templateRuleKind(rule: Record<string, unknown>): string {
  // The catalogue normalizer adds type="deterministic" without replacing
  // the original kind (exact/tolerance). Preserve that actual predicate.
  return String(rule.kind ?? rule.type ?? "");
}

function toleranceField(key: string, sampleFields: string[]): string | null {
  const base = key.replace(/_(abs|pct)$/u, "");
  if (sampleFields.includes(base)) return base;
  if (base === "qty" && sampleFields.includes("quantity")) return "quantity";
  if (base === "amount" && sampleFields.includes("gross_amount")) return "gross_amount";
  if (base === "margin" && sampleFields.includes("total_margin")) return "total_margin";
  if (sampleFields.includes(key)) return key;
  return null;
}

export function starterTemplateFields(template: StarterTemplate): string[] {
  const fields = new Set(template.keys ?? []);
  for (const currency of ["currency", "ccy"]) {
    if (template.legs.length > 1 && template.sample_fields?.includes(currency)) fields.add(currency);
  }
  for (const rule of template.rules ?? []) fieldsFromRule(rule).forEach((field) => fields.add(field));
  for (const key of Object.keys(template.tolerances ?? {})) {
    const field = toleranceField(key, template.sample_fields ?? []);
    if (field) fields.add(field);
  }
  for (const rule of template.rules ?? []) {
    if (templateRuleKind(rule) === "zero_balance") fields.add("amount");
    if (templateRuleKind(rule) === "ageing") fields.add("posted_at");
  }
  return [...fields];
}

function ruleId(prefix: string, field: string, index: number): string {
  return `tpl-${prefix}-${String(index + 1).padStart(2, "0")}-${field}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, "-")
    .slice(0, 64);
}

export function compileReconStarterTemplate(
  template: StarterTemplate,
  bindings: StarterBinding[],
): ReconSpec {
  const legCount = template.legs?.length ?? 0;
  if (legCount < 1 || legCount > 3 || bindings.length !== legCount) {
    throw new Error("Every template leg must have exactly one source binding");
  }
  const sourceIds = bindings.map((binding) => binding.data_source_id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error("Each template leg must use a distinct data source");
  }
  const required = starterTemplateFields(template);
  for (const binding of bindings) {
    for (const field of required) {
      if (!binding.field_map[field]) throw new Error(`Missing field mapping for ${field}`);
    }
  }

  const sides = bindings.map((binding, index) => ({
    side_id: SIDE_IDS[index],
    label: template.legs[index]?.name?.trim() || `Side ${index + 1}`,
    data_source_id: binding.data_source_id,
  }));
  const mapped = (field: string) => Object.fromEntries(
    bindings.map((binding, index) => [SIDE_IDS[index], binding.field_map[field]]),
  );
  const rules: ReconSpec["rules"] = [];
  const seen = new Set<string>();
  const add = (field: string, kind: RuleKind, params?: Record<string, unknown>, isKey = false) => {
    const signature = `${field}:${kind}:${isKey}`;
    if (seen.has(signature)) return;
    seen.add(signature);
    rules.push({
      id: ruleId(isKey ? "key" : kind, field, rules.length),
      kind,
      description: `${template.code}: ${field}`,
      fields: mapped(field),
      ...(params ? { params } : {}),
      ...(isKey ? { is_key: true } : {}),
    });
  };
  const addTolerance = (field: string, absolute: unknown, percentage: unknown) => {
    const limits = [absolute, percentage].filter((value) => value !== undefined);
    if (!limits.length || limits.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
      throw new Error("Template tolerance requires non-negative numeric limits");
    }
    if (typeof absolute === "number" && typeof percentage === "number" && percentage > 0) {
      add(field, "multi_pass", { passes: ["numeric_tolerance_abs", "numeric_tolerance_pct"], tolerance: absolute, pct: percentage * 100 });
    } else if (typeof absolute === "number") {
      add(field, "numeric_tolerance_abs", { tolerance: absolute });
    } else if (percentage === 0) {
      add(field, "numeric_tolerance_abs", { tolerance: 0 });
    } else {
      add(field, "numeric_tolerance_pct", { pct: Number(percentage) * 100 });
    }
  };

  for (const key of template.keys ?? []) {
    add(key, legCount === 1 ? "unique" : "exact_match", undefined, legCount > 1);
    add(key, "non_null");
  }
  for (const currency of ["currency", "ccy"]) {
    if (legCount > 1 && template.sample_fields?.includes(currency)) {
      add(currency, "currency_equals");
      add(currency, "non_null");
    }
  }
  for (const raw of template.rules ?? []) {
    const fields = fieldsFromRule(raw);
    const type = templateRuleKind(raw);
    if (!["exact", "exact_match", "tolerance", "zero_balance", "ageing"].includes(type)) {
      throw new Error(`Template rule ${type || "without a kind"} is not supported`);
    }
    if (type === "exact" || type === "exact_match") {
      fields.filter((field) => !(template.keys ?? []).includes(field))
        .forEach((field) => add(field, "exact_match"));
    }
    if (type === "tolerance") {
      if (!fields.length) throw new Error("Template tolerance requires a field");
      for (const field of fields) {
        addTolerance(field, raw.abs, raw.pct);
      }
    }
    if (legCount === 1 && type === "zero_balance") {
      const amount = template.tolerances?.amount as { abs?: number } | undefined;
      const tolerance = typeof amount?.abs === "number" ? amount.abs : 0;
      add("amount", "value_range", { min: -tolerance, max: tolerance });
    }
    if (type === "ageing") {
      if (legCount !== 1) throw new Error("Ageing starter requires a single-sided reconciliation");
      const buckets = Array.isArray(raw.buckets) ? raw.buckets : [];
      const days = buckets.find((value) => typeof value === "number" && value > 0);
      if (typeof days !== "number" || !Number.isFinite(days)) throw new Error("Ageing starter requires a positive day threshold");
      add("posted_at", "date_age_days", { days });
    }
    if (type === "zero_balance" && legCount !== 1) throw new Error("Zero-balance starter requires a single-sided reconciliation");
  }
  for (const [key, value] of Object.entries(template.tolerances ?? {})) {
    const field = toleranceField(key, template.sample_fields ?? []);
    if (!field || legCount === 1) continue;
    if (typeof value === "number" && key.endsWith("_abs")) addTolerance(field, value, undefined);
    if (typeof value === "number" && key.endsWith("_pct")) addTolerance(field, undefined, value);
    if (value && typeof value === "object") {
      const tolerance = value as { abs?: unknown; pct?: unknown };
      addTolerance(field, tolerance.abs, tolerance.pct);
    }
  }
  if (!rules.length) throw new Error("Template does not compile to an executable rule set");
  return {
    recon_type: legCount === 1 ? "one_sided" : legCount === 2 ? "two_sided" : "three_sided",
    sides,
    rules,
  };
}
