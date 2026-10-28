import type { ReconSpec, RuleSpec } from "@/lib/recon-engine";

type WizardMode = ReconSpec["recon_type"];
type WizardSide = { side_id: string; columns: string[] };

export type WizardMappingPlan = {
  mappings: Record<string, Record<string, string>>;
  keys: string[];
  amount: string;
  date: string;
  rules: [];
};

const TOKEN_ALIASES: Record<string, string> = {
  amt: "amount", balance: "amount", gross: "amount", net: "amount", notional: "amount",
  qty: "quantity", ref: "reference", txn: "transaction", trans: "transaction",
  trade: "transaction", val: "value", dt: "date",
};

function mappingTokens(value: string): string[] {
  return value.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/gu).filter(Boolean).map((token) => TOKEN_ALIASES[token] ?? token);
}

function mappingLevenshtein(left: string, right: string): number {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  const rows = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let index = 0; index <= a.length; index++) rows[index][0] = index;
  for (let index = 0; index <= b.length; index++) rows[0][index] = index;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = a[i - 1] === b[j - 1]
        ? rows[i - 1][j - 1]
        : 1 + Math.min(rows[i - 1][j], rows[i][j - 1], rows[i - 1][j - 1]);
    }
  }
  return rows[a.length][b.length];
}

function mappingRole(items: string[]) {
  if (items.some((token) => ["date", "time", "timestamp"].includes(token))) return "date";
  if (items.some((token) => ["amount", "quantity", "nav"].includes(token))) return "number";
  if (items.some((token) => ["id", "reference", "transaction", "key"].includes(token))) return "identifier";
  return "other";
}

function mappingSimilarity(left: string, right: string): number {
  const leftTokens = mappingTokens(left);
  const rightTokens = mappingTokens(right);
  const leftRole = mappingRole(leftTokens);
  const rightRole = mappingRole(rightTokens);
  if (leftRole !== "other" && rightRole !== "other" && leftRole !== rightRole) return 0;
  const normalizedLeft = leftTokens.join("_");
  const normalizedRight = rightTokens.join("_");
  if (normalizedLeft === normalizedRight) return 1;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const intersection = [...leftSet].filter((token) => rightSet.has(token)).length;
  const union = new Set([...leftSet, ...rightSet]).size || 1;
  const tokenScore = intersection / union;
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length, 1);
  const editScore = 1 - mappingLevenshtein(normalizedLeft, normalizedRight) / maxLength;
  const roleScore = leftRole !== "other" && leftRole === rightRole ? 0.6 : 0;
  return Math.max(tokenScore, editScore, roleScore);
}

export function suggestWizardMapping(sides: WizardSide[]) {
  const base = sides[0];
  if (!base) return { mappings: {}, suggested_keys: [], suggested_amount: null, suggested_date: null };
  const mappings: Record<string, Record<string, string>> = {};
  for (const column of base.columns) {
    mappings[column] = { [base.side_id]: column };
    for (const other of sides.slice(1)) {
      const ranked = other.columns.map((candidate) => ({ candidate, score: mappingSimilarity(column, candidate) }))
        .sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate));
      mappings[column][other.side_id] = (ranked[0]?.score ?? 0) >= 0.5 ? ranked[0].candidate : "";
    }
  }
  const suggestedKeys = base.columns.filter((column) => /(^|_)(id|ref|reference|trade|txn|transaction|key)($|_)/iu.test(column));
  const suggestedAmount = base.columns.find((column) => mappingRole(mappingTokens(column)) === "number");
  const suggestedDate = base.columns.find((column) => mappingRole(mappingTokens(column)) === "date");
  return {
    mappings,
    suggested_keys: suggestedKeys.slice(0, 2),
    suggested_amount: suggestedAmount ?? null,
    suggested_date: suggestedDate ?? null,
  };
}

function isMappingRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateWizardMappingPlan(value: unknown, sides: WizardSide[]): WizardMappingPlan {
  if (!isMappingRecord(value) || !isMappingRecord(value.mappings)) throw new Error("AI returned an invalid mapping plan");
  const base = sides[0];
  if (!base) throw new Error("At least one source is required");
  const sideColumns = new Map(sides.map((side) => [side.side_id, new Set(side.columns)]));
  const mappings: Record<string, Record<string, string>> = {};
  for (const [canonical, rawMapping] of Object.entries(value.mappings)) {
    if (!/^[\p{L}\p{N}_. -]{1,120}$/u.test(canonical) || !isMappingRecord(rawMapping)) continue;
    const mapping: Record<string, string> = {};
    for (const side of sides) {
      const rawColumn = rawMapping[side.side_id];
      const column = typeof rawColumn === "string" ? rawColumn : "";
      mapping[side.side_id] = column && sideColumns.get(side.side_id)?.has(column) ? column : "";
    }
    if (Object.values(mapping).some(Boolean)) mappings[canonical] = mapping;
  }
  if (Object.keys(mappings).length === 0) throw new Error("AI returned no valid source-column mappings");
  const fullyMapped = (canonical: string) => sides.every((side) => Boolean(mappings[canonical]?.[side.side_id]));
  const canonicalFor = (candidate: unknown) => {
    if (typeof candidate !== "string") return "";
    if (mappings[candidate]) return candidate;
    return Object.keys(mappings).find((canonical) => mappings[canonical]?.[base.side_id] === candidate) ?? "";
  };
  const keys = Array.isArray(value.keys)
    ? [...new Set(value.keys.map(canonicalFor).filter((key) => key && fullyMapped(key)))].slice(0, 10)
    : [];
  const field = (candidate: unknown) => {
    const canonical = canonicalFor(candidate);
    return canonical && fullyMapped(canonical) ? canonical : "";
  };
  return { mappings, keys, amount: field(value.amount), date: field(value.date), rules: [] };
}

export type WizardRuleInput = {
  mode: WizardMode;
  sides: WizardSide[];
  mappings: Record<string, Record<string, string>>;
  keys: string[];
  amountField?: string | null;
  dateField?: string | null;
};

function mappedFields(input: WizardRuleInput, canonical: string): Record<string, string> | null {
  const mapping = input.mappings[canonical] ?? {};
  const fields: Record<string, string> = {};
  for (const side of input.sides) {
    const field = mapping[side.side_id] || (side.columns.includes(canonical) ? canonical : "");
    if (!field || !side.columns.includes(field)) return null;
    fields[side.side_id] = field;
  }
  return fields;
}

export function compileWizardRules(input: WizardRuleInput): RuleSpec[] {
  const rules: RuleSpec[] = [];

  if (input.mode === "one_sided") {
    for (const key of input.keys) {
      const fields = mappedFields(input, key);
      if (fields) rules.push({ id: `wizard_unique_${key}`, kind: "unique", fields });
    }
    if (input.dateField) {
      const fields = mappedFields(input, input.dateField);
      if (fields) rules.push({ id: "wizard_date_required", kind: "non_null", fields });
    }
    if (input.amountField) {
      const fields = mappedFields(input, input.amountField);
      if (fields) rules.push({ id: "wizard_amount_numeric", kind: "numeric_equals", fields });
    }
    if (rules.length === 0) {
      const firstColumn = input.sides[0]?.columns[0];
      const fields = firstColumn ? mappedFields(input, firstColumn) : null;
      if (fields) rules.push({ id: "wizard_required_value", kind: "non_null", fields });
    }
    if (rules.length === 0) throw new Error("One-sided wizard requires at least one mapped field");
    return rules;
  }

  for (const key of input.keys) {
    const fields = mappedFields(input, key);
    if (!fields) throw new Error(`Wizard key '${key}' is not mapped on every side`);
    rules.push({ id: `wizard_key_${key}`, kind: "exact_match", fields, is_key: true });
  }
  if (rules.length === 0) throw new Error("Multi-sided wizard requires at least one mapped key");

  if (input.amountField) {
    const fields = mappedFields(input, input.amountField);
    if (!fields) throw new Error("Wizard amount field is not mapped on every side");
    rules.push({
      id: "wizard_amount_sum",
      kind: "sum_to_match",
      fields,
      params: { tolerance: 0.01 },
    });
  }
  if (input.dateField) {
    const fields = mappedFields(input, input.dateField);
    if (!fields) throw new Error("Wizard date field is not mapped on every side");
    rules.push({
      id: "wizard_date_window",
      kind: "date_tolerance_days",
      fields,
      params: { days: 1 },
    });
  }
  return rules;
}
