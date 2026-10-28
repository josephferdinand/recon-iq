import { fromCrossJSON } from "seroval";
import { defaultSerovalPlugins } from "@tanstack/router-core";
/** Offline only: no network or business operation replay. */
export function decodeSavedResponse(payload, serialized) {
  return serialized ? fromCrossJSON(payload, { plugins: defaultSerovalPlugins }) : payload;
}
