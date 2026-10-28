// Industry-recognized Data Prep transformation catalog (42 rules).
// Each entry: kind, label, category, description, param shape for the UI.
// The execution engine in data-prep.functions.ts reads `kind` and the params.

export type TransformParam =
  | { name: string; label: string; kind: "text"; placeholder?: string; required?: boolean }
  | { name: string; label: string; kind: "number"; placeholder?: string; required?: boolean }
  | { name: string; label: string; kind: "csv"; placeholder?: string; required?: boolean } // comma list
  | { name: string; label: string; kind: "select"; options: string[]; required?: boolean };

export type TransformDef = {
  kind: string;
  label: string;
  category: "Cleanse" | "Cast & Parse" | "Structure" | "Derive" | "Finance & Identifiers" | "Privacy" | "Quality";
  description: string;
  params: TransformParam[];
};

export const TRANSFORM_CATALOG: TransformDef[] = [
  // Cleanse (text hygiene)
  { kind: "trim", label: "Trim whitespace", category: "Cleanse", description: "Remove leading/trailing whitespace.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "ltrim", label: "Left trim", category: "Cleanse", description: "Remove leading whitespace.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "rtrim", label: "Right trim", category: "Cleanse", description: "Remove trailing whitespace.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "collapse_whitespace", label: "Collapse whitespace", category: "Cleanse", description: "Replace runs of whitespace with a single space.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "uppercase", label: "Uppercase", category: "Cleanse", description: "Convert to UPPER CASE.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "lowercase", label: "Lowercase", category: "Cleanse", description: "Convert to lower case.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "titlecase", label: "Title case", category: "Cleanse", description: "Convert To Title Case.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "remove_non_printable", label: "Strip non-printable", category: "Cleanse", description: "Remove control characters and zero-width chars.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "pad_left", label: "Pad left", category: "Cleanse", description: "Left-pad to fixed length.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "length", label: "Length", kind: "number", required: true }, { name: "char", label: "Pad char", kind: "text", placeholder: "0" }] },
  { kind: "pad_right", label: "Pad right", category: "Cleanse", description: "Right-pad to fixed length.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "length", label: "Length", kind: "number", required: true }, { name: "char", label: "Pad char", kind: "text", placeholder: " " }] },
  { kind: "substring", label: "Substring", category: "Cleanse", description: "Slice characters [start, end).", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "start", label: "Start", kind: "number", required: true }, { name: "end", label: "End", kind: "number" }] },
  { kind: "replace", label: "Replace text", category: "Cleanse", description: "Literal find/replace.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "find", label: "Find", kind: "text", required: true }, { name: "replace", label: "Replace with", kind: "text" }] },
  { kind: "regex_replace", label: "Regex replace", category: "Cleanse", description: "Pattern-based replace.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "pattern", label: "Regex", kind: "text", required: true }, { name: "replace", label: "Replacement", kind: "text" }] },

  // Cast & Parse
  { kind: "cast_number", label: "Cast to number", category: "Cast & Parse", description: "Parse numeric (handles commas, spaces).", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "cast_int", label: "Cast to integer", category: "Cast & Parse", description: "Round to integer.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "cast_boolean", label: "Cast to boolean", category: "Cast & Parse", description: "true/1/yes/y → true.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "cast_date", label: "Cast to ISO date", category: "Cast & Parse", description: "Parse to ISO-8601 timestamp.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "parse_date_format", label: "Parse date with format", category: "Cast & Parse", description: "Parse using DD/MM/YYYY etc.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "format", label: "Format", kind: "select", options: ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MMM-YYYY", "YYYYMMDD"], required: true }] },
  { kind: "round", label: "Round", category: "Cast & Parse", description: "Round numeric to N decimals.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "decimals", label: "Decimals", kind: "number", required: true }] },
  { kind: "abs", label: "Absolute value", category: "Cast & Parse", description: "Convert to positive number.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },

  // Structure
  { kind: "rename", label: "Rename column", category: "Structure", description: "Rename one column.", params: [{ name: "field", label: "From", kind: "text", required: true }, { name: "to", label: "To", kind: "text", required: true }] },
  { kind: "drop_columns", label: "Drop columns", category: "Structure", description: "Remove one or more columns.", params: [{ name: "fields", label: "Fields (comma list)", kind: "csv", required: true }] },
  { kind: "select_columns", label: "Keep only columns", category: "Structure", description: "Project a subset of columns.", params: [{ name: "fields", label: "Fields (comma list)", kind: "csv", required: true }] },
  { kind: "fill_null", label: "Fill nulls", category: "Structure", description: "Replace nulls with a constant.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "value", label: "Default value", kind: "text", required: true }] },
  { kind: "coalesce", label: "Coalesce columns", category: "Structure", description: "First non-null across columns → new field.", params: [{ name: "fields", label: "Source fields (csv)", kind: "csv", required: true }, { name: "to", label: "Target field", kind: "text", required: true }] },
  { kind: "dedupe", label: "Deduplicate rows", category: "Structure", description: "Drop duplicate rows by key columns.", params: [{ name: "fields", label: "Key fields (csv)", kind: "csv", required: true }] },
  { kind: "sort", label: "Sort", category: "Structure", description: "Sort rows by field.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "direction", label: "Direction", kind: "select", options: ["asc", "desc"] }] },
  { kind: "filter", label: "Filter (keep if regex)", category: "Structure", description: "Keep rows where field matches regex.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "pattern", label: "Regex", kind: "text", required: true }] },
  { kind: "filter_expr", label: "Filter (expression)", category: "Structure", description: "Keep rows matching =, !=, >, <, >=, <=.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "expr", label: "Expression", kind: "text", placeholder: "> 100", required: true }] },

  // Derive
  { kind: "derive_concat", label: "Derive — concat", category: "Derive", description: "Concatenate fields with separator into a new field.", params: [{ name: "fields", label: "Source fields (csv)", kind: "csv", required: true }, { name: "to", label: "Target field", kind: "text", required: true }, { name: "separator", label: "Separator", kind: "text", placeholder: " " }] },
  { kind: "derive_arithmetic", label: "Derive — arithmetic", category: "Derive", description: "left op right (+ - * /) → target.", params: [{ name: "left", label: "Left field", kind: "text", required: true }, { name: "op", label: "Op", kind: "select", options: ["+", "-", "*", "/"], required: true }, { name: "right", label: "Right field", kind: "text", required: true }, { name: "to", label: "Target field", kind: "text", required: true }] },
  { kind: "split", label: "Split field", category: "Derive", description: "Split by delimiter → take token N (1-based).", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "delimiter", label: "Delimiter", kind: "text", required: true }, { name: "index", label: "Token #", kind: "number", required: true }, { name: "to", label: "Target field", kind: "text", required: true }] },
  { kind: "json_extract", label: "JSON extract", category: "Derive", description: "Pluck a path from a JSON string column.", params: [{ name: "field", label: "JSON field", kind: "text", required: true }, { name: "path", label: "Dotted path", kind: "text", placeholder: "data.amount", required: true }, { name: "to", label: "Target field", kind: "text", required: true }] },

  // Finance & Identifiers
  { kind: "normalize_currency_amount", label: "Normalize currency amount", category: "Finance & Identifiers", description: "Strip symbols & thousands separators; cast to number.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "flip_sign_when", label: "Flip sign by indicator", category: "Finance & Identifiers", description: "Negate amount when indicator field equals value (e.g. DR).", params: [{ name: "amount_field", label: "Amount field", kind: "text", required: true }, { name: "indicator_field", label: "Indicator field", kind: "text", required: true }, { name: "indicator_value", label: "When equals", kind: "text", placeholder: "DR", required: true }] },
  { kind: "normalize_iban", label: "Normalize IBAN", category: "Finance & Identifiers", description: "Uppercase, strip spaces; flag invalid via DQ if needed.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "normalize_bic", label: "Normalize BIC/SWIFT", category: "Finance & Identifiers", description: "Uppercase, strip spaces; 8 or 11 chars expected.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "normalize_isin", label: "Normalize ISIN", category: "Finance & Identifiers", description: "Uppercase, strip spaces; 12 alphanumerics expected.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "normalize_country", label: "Normalize country to ISO-2", category: "Finance & Identifiers", description: "Map common names to ISO-3166 alpha-2 (e.g. \"United States\" → US).", params: [{ name: "field", label: "Field", kind: "text", required: true }] },

  // Privacy
  { kind: "mask_pii", label: "Mask PII", category: "Privacy", description: "Mask all but last N chars (e.g. card/SSN).", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "show_last", label: "Show last #", kind: "number", placeholder: "4" }] },
  { kind: "hash_field", label: "Hash (SHA-256)", category: "Privacy", description: "Replace value with its SHA-256 hex digest.", params: [{ name: "field", label: "Field", kind: "text", required: true }] },
  { kind: "redact", label: "Redact", category: "Privacy", description: "Replace value with a fixed token.", params: [{ name: "field", label: "Field", kind: "text", required: true }, { name: "token", label: "Token", kind: "text", placeholder: "[REDACTED]" }] },
];

export const TRANSFORM_BY_KIND = Object.fromEntries(TRANSFORM_CATALOG.map((t) => [t.kind, t]));

export const TRANSFORM_CATEGORIES = Array.from(new Set(TRANSFORM_CATALOG.map((t) => t.category)));
