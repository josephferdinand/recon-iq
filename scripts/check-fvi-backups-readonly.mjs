import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseCanonicalVault, TARGETS } from "./preflight-fvi-resource-identity-release.mjs";

const vaultPath = process.env.FVI_VAULT_PATH ?? "";
if (!path.isAbsolute(vaultPath) || path.basename(vaultPath) !== "Falcon-Veritas-Keys.md") {
  throw new Error("Set FVI_VAULT_PATH to the canonical FVI secured vault");
}
const token = parseCanonicalVault(await readFile(vaultPath, "utf8"));
for (const [target, ref] of Object.entries(TARGETS)) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/backups`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${target} backup read failed: HTTP ${response.status}`);
  const result = await response.json();
  const backups = Array.isArray(result.backups) ? result.backups : [];
  const completed = backups.filter((backup) => backup.status === "COMPLETED")
    .sort((left, right) => String(right.inserted_at).localeCompare(String(left.inserted_at)));
  console.log(JSON.stringify({
    target,
    project_ref: ref,
    pitr_enabled: result.pitr_enabled ?? null,
    completed_backup_count: completed.length,
    latest_completed_backup_at: completed[0]?.inserted_at ?? null,
    latest_completed_backup_type: completed[0]?.type ?? null,
    backup_statuses: [...new Set(backups.map((backup) => backup.status))],
    credential_value_exposed: false,
  }));
}
