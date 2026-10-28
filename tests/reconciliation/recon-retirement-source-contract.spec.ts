import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const server = read("src/lib/recons.functions.ts");
const retirementServer = read("src/lib/recon-retirement.functions.ts");
const component = read("src/components/recons-tab.tsx");
const migration = read("supabase/migrations/20260924140000_govern_reconciliation_retirement.sql");
const sqlRegression = read("tests/sql/recon-retirement-governance-regression.sql");

function between(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  expect(startAt, `missing source marker: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endAt, `missing source marker: ${end}`).toBeGreaterThan(startAt);
  return source.slice(startAt, endAt);
}

describe("reconciliation retirement source contract", () => {
  it("allows direct deletion only for drafts after a successful no-run-history check", () => {
    const handler = between(server, "export const deleteRecon", "export const runReconDefinition");
    expect(handler).toMatch(/definition\.status\s*!==\s*["']draft["']/);
    expect(handler).toMatch(/\.from\(["']recon_runs["']\)[\s\S]*?count:\s*["']exact["'][\s\S]*?head:\s*true/);
    expect(handler).toMatch(/runsError\s*\|\|\s*count\s*===\s*null/);
    expect(handler).toMatch(/if\s*\(count\s*>\s*0\)[\s\S]*?cannot be directly deleted/);
    expect(handler).toMatch(/if\s*\(runsError\s*\|\|\s*count\s*===\s*null\)[\s\S]*?Nothing was deleted/);
    expect(handler).toMatch(/\.from\(["']recon_definitions["']\)\.delete\(\)/);
  });

  it("requires a reason for both a retirement request and its decision", () => {
    expect(retirementServer).toMatch(/const Request\s*=\s*Scope\.extend\(\{[^}]*reason:\s*z\.string\(\)\.trim\(\)\.min\(12\)/s);
    expect(retirementServer).toMatch(/const Decision\s*=\s*z\.object\(\{[^}]*reason:\s*z\.string\(\)\.trim\(\)\.min\(12\)/s);
    expect(migration).toMatch(/_reason\s+IS\s+NULL\s+OR\s+length\(btrim\(_reason\)\)\s+NOT\s+BETWEEN\s+1\s+AND\s+2000/i);
  });

  it("reports an uninstalled retirement queue as unavailable instead of an empty queue", () => {
    expect(retirementServer).toMatch(/error\?\.code\s*===\s*["']42P01["']\s*\|\|\s*error\?\.code\s*===\s*["']PGRST205["'][\s\S]*?available:\s*false,\s*rows:\s*\[\]/);
    expect(component).toContain("The two-person retirement workflow is not installed in this environment.");
    expect(component).toMatch(/disabled=\{!retirements\.data\?\.available\}/);
  });

  it("does not offer a requester an approval or rejection control", () => {
    const requestCard = between(component, "retirements.data.rows.map((request)", "<Card>\n        <CardHeader className=\"flex flex-row items-start justify-between gap-4\">");
    expect(requestCard).toMatch(/!request\.mine\s*&&\s*<div[\s\S]*?Approve retirement[\s\S]*?Reject/);
    expect(retirementServer).toContain("mine: row.requested_by === context.userId");
    expect(migration).toMatch(/IF\s+actor=request_row\.requested_by\s+THEN\s+RAISE EXCEPTION 'requester cannot approve own retirement'/i);
  });

  it("retires by tombstoning and keeps prior result evidence queryable", () => {
    const decide = between(migration, "CREATE OR REPLACE FUNCTION public.decide_recon_retirement", "REVOKE ALL ON FUNCTION public.request_recon_retirement");
    expect(decide).toMatch(/UPDATE public\.recon_definitions[\s\S]*?SET status='archived',retired_at=retired_timestamp,retirement_request_id=request_row\.id/i);
    expect(decide).not.toMatch(/DELETE\s+FROM\s+public\.recon_(runs|matches|exceptions)/i);
    expect(sqlRegression).toMatch(/count\(\*\) FROM public\.recon_runs WHERE definition_id=result\.recon_id/);
    expect(sqlRegression).toMatch(/count\(\*\) FROM public\.recon_matches WHERE run_id=/);
    expect(sqlRegression).toMatch(/count\(\*\) FROM public\.recon_exceptions WHERE run_id=/);
    expect(sqlRegression).toContain("retirement removed run, match, or exception evidence");
  });
});
