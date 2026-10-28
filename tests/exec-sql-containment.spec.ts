import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  "supabase/migrations/20260901200500_contain_untracked_exec_sql_rpc.sql",
);
const migration = readFileSync(migrationPath, "utf8").toLowerCase();
const removal = readFileSync(
  path.resolve("supabase/migrations/20260901203000_drop_untracked_exec_sql_rpc.sql"),
  "utf8",
).toLowerCase();

describe("untracked exec_sql RPC containment", () => {
  it("is conditional so clean schema replay remains deterministic", () => {
    expect(migration).toContain("to_regprocedure('public.exec_sql(text)') is not null");
  });

  it("removes every client execution grant and retains only service-role compatibility", () => {
    expect(migration).toContain(
      "revoke all on function public.exec_sql(text) from public, anon, authenticated",
    );
    expect(migration).toContain("grant execute on function public.exec_sql(text) to service_role");
  });

  it("removes the untracked function after containment and dependency proof", () => {
    expect(removal).toContain("if to_regprocedure('public.exec_sql(text)') is not null");
    expect(removal).toContain("drop function public.exec_sql(text)");
    expect(removal).not.toContain("cascade");
  });
});
