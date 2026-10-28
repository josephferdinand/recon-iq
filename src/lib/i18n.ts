import { getPrefs } from "@/lib/user-prefs";

type Dict = Record<string, string>;
const dictionaries: Record<string, Dict> = {
  en: {
    "common.search": "Search",
    "common.export": "Export",
    "common.cancel": "Cancel",
    "common.save": "Save",
    "common.loading": "Loading…",
    "common.empty": "Nothing here yet",
    "exceptions.bulkResolve": "Bulk resolve",
    "exceptions.escalate": "Escalate",
  },
  fr: {
    "common.search": "Rechercher",
    "common.export": "Exporter",
    "common.cancel": "Annuler",
    "common.save": "Enregistrer",
    "common.loading": "Chargement…",
    "common.empty": "Aucun élément",
    "exceptions.bulkResolve": "Résoudre en lot",
    "exceptions.escalate": "Escalader",
  },
  es: {
    "common.search": "Buscar",
    "common.export": "Exportar",
    "common.cancel": "Cancelar",
    "common.save": "Guardar",
    "common.loading": "Cargando…",
    "common.empty": "Sin elementos",
    "exceptions.bulkResolve": "Resolver en lote",
    "exceptions.escalate": "Escalar",
  },
  de: {
    "common.search": "Suchen",
    "common.export": "Exportieren",
    "common.cancel": "Abbrechen",
    "common.save": "Speichern",
    "common.loading": "Lädt…",
    "common.empty": "Noch keine Einträge",
    "exceptions.bulkResolve": "Massenauflösen",
    "exceptions.escalate": "Eskalieren",
  },
};

export function t(key: string): string {
  const locale = getPrefs().locale ?? "en";
  return dictionaries[locale]?.[key] ?? dictionaries.en[key] ?? key;
}

/**
 * Locale allowlist.
 *
 * Includes both bare 2-letter BCP-47 codes (used by `t()` lookup keys in
 * `dictionaries`) and region-tagged forms (used by the /profile UI's
 * Language <Select> — which displays "English (US)" etc.). Bare codes are
 * kept for backwards compatibility with previously-saved values.
 *
 * Bug-fix LL-066: earlier this was only the 4 bare codes, which made the
 * Contact section's "Save contact" throw "Unsupported locale" for every
 * region-tagged value the UI rendered.
 */
export const supportedLocales = [
  "en", "en-US", "en-GB", "en-CA", "en-AU",
  "fr", "fr-FR", "fr-CA",
  "es", "es-ES", "es-MX",
  "de", "de-DE", "de-AT",
  "hi", "hi-IN",
  "ja", "ja-JP",
  "zh", "zh-CN", "zh-TW",
  "pt", "pt-BR",
  "ar", "ar-SA",
  "it", "it-IT",
  "ko", "ko-KR",
] as const;

export type SupportedLocale = (typeof supportedLocales)[number];
