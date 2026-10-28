/**
 * ReconIQ Copilot — per-tenant semantic lexicon resolver.
 *
 * Returns the tenant's `copilot_lexicon_overrides` row layered over the
 * global `DEFAULT_LEXICON`. Used by the Copilot to translate natural
 * language (status synonyms, time phrases, severity, role aliases) into
 * structured tool arguments.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LEXICON } from "./copilot-semantics-defaults";

export interface SemanticLexicon {
  statusSynonyms: Record<string, string[]>;
  timePhrases: Array<{ pattern: RegExp; since: "today" | "24h" | "7d" | "30d" }>;
  severityAliases: Record<string, string>;
  roleAliases: Record<string, string>;
}

export { DEFAULT_LEXICON };

interface OverrideRow {
  status_synonyms?: Record<string, string[]> | null;
  time_phrases?: Array<{ pattern: string; flags?: string; since: SemanticLexicon["timePhrases"][number]["since"] }> | null;
  severity_aliases?: Record<string, string> | null;
  role_aliases?: Record<string, string> | null;
}

function compileTimePhrases(
  rows: OverrideRow["time_phrases"],
): SemanticLexicon["timePhrases"] {
  if (!Array.isArray(rows)) return [];
  const out: SemanticLexicon["timePhrases"] = [];
  for (const r of rows) {
    if (!r?.pattern || !r?.since) continue;
    try {
      out.push({ pattern: new RegExp(r.pattern, r.flags ?? "i"), since: r.since });
    } catch {
      // Invalid override regex — skip silently rather than break Copilot.
    }
  }
  return out;
}

export async function getLexiconForTenant(
  supabase: Pick<SupabaseClient, "from"> | null,
  tenantId: string | null,
): Promise<SemanticLexicon> {
  if (!supabase || !tenantId) return DEFAULT_LEXICON;
  try {
    const { data, error } = await (supabase.from("copilot_lexicon_overrides") as any)
      .select("status_synonyms, time_phrases, severity_aliases, role_aliases")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error || !data) return DEFAULT_LEXICON;
    const row = data as OverrideRow;
    const compiledTime = compileTimePhrases(row.time_phrases);
    return {
      statusSynonyms: { ...DEFAULT_LEXICON.statusSynonyms, ...(row.status_synonyms ?? {}) },
      timePhrases: compiledTime.length ? compiledTime : DEFAULT_LEXICON.timePhrases,
      severityAliases: { ...DEFAULT_LEXICON.severityAliases, ...(row.severity_aliases ?? {}) },
      roleAliases: { ...DEFAULT_LEXICON.roleAliases, ...(row.role_aliases ?? {}) },
    };
  } catch {
    return DEFAULT_LEXICON;
  }
}
