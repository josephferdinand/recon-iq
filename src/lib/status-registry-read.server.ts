type RegistryClient = { from: (table: string) => any };
/** Explicit pagination avoids treating PostgREST's default row cap as a complete
 * registry. Fail closed at a bounded 10,000 entries rather than hide scopes. */
export async function readRegisteredStatusRows(client: RegistryClient, kind: "cells" | "functions") {
  const table = kind === "cells" ? "status_environment_registry" : "status_function_registry";
  const columns = kind === "cells" ? "cell_key,environment_key,display_name,region_code,region_label,enabled" : "cell_key,function_key,function_label,component_key,availability";
  const rows: any[] = [];
  for (let offset = 0; offset <= 10000; offset += 500) {
    let query = client.from(table).select(columns).order("cell_key");
    if (kind === "functions") query = query.order("function_key");
    const { data, error } = await query.range(offset, offset + 499).abortSignal(AbortSignal.timeout(8_000));
    if (error || !Array.isArray(data)) throw new Error("The complete registered status scope could not be loaded. Retry after registry access is verified.");
    rows.push(...data);
    if (rows.length > 10000) throw new Error("The status registry exceeds this view's verified capacity. Full registry pagination is required before incident editing.");
    if (data.length < 500) return rows;
  }
  throw new Error("The complete status registry could not be verified.");
}
