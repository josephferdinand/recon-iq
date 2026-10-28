/**
 * Shared chainable Supabase mock for Copilot tool tests.
 * Records call sequence so tests can assert tenant scoping behaviour.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface MockSupaOptions {
  tableData?: Record<string, any[]>;
  rpcData?: Record<string, any>;
  countOverride?: Record<string, number>;
  log?: string[];
}

export function makeMockSupa(opts: MockSupaOptions = {}): SupabaseClient {
  const log = opts.log;
  const tableData = opts.tableData ?? {};
  const rpcData = opts.rpcData ?? {};

  return {
    from(table: string) {
      log?.push(`from:${table}`);
      const rows = tableData[table] ?? [];
      const count = opts.countOverride?.[table] ?? rows.length;
      const builder: any = {};
      const chain = (name: string) => (...args: any[]) => {
        log?.push(`${name}:${args[0] !== undefined ? JSON.stringify(args[0]) : ""}`);
        return builder;
      };
      for (const m of [
        "select","eq","is","in","gte","lte","lt","gt","or","ilike",
        "order","limit","range","not","filter","contains",
      ]) {
        builder[m] = chain(m);
      }
      builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
      builder.then = (resolve: any, reject: any) =>
        Promise.resolve({ data: rows, count, error: null }).then(resolve, reject);
      return builder;
    },
    rpc(name: string) {
      log?.push(`rpc:${name}`);
      return Promise.resolve({ data: rpcData[name] ?? null, error: null }) as any;
    },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  } as unknown as SupabaseClient;
}
