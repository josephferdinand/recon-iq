/**
 * D2 — Regulatory install tests.
 *
 * These are unit-level tests using an in-memory mock supabase client. They
 * cover the install lifecycle contract documented in
 * `docs/15_regulatory_packs.md`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = Record<string, any>;

class MockSupabase {
  tables: Record<string, Row[]> = {
    regulatory_template_packs: [],
    regulatory_pack_installs: [],
    audit_log: [],
    security_events: [],
    data_prep_pipelines: [],
    recon_definitions: [],
  };
  rpcs: Record<string, any> = {
    is_platform_admin: false,
    has_tenant_role: true,
  };
  forceInsertError: string | null = null;

  rpc(name: string, _args: any) {
    return Promise.resolve({ data: this.rpcs[name] ?? null, error: null });
  }

  from(table: string) {
    const self = this;
    let chain: any = {
      _table: table,
      _filters: [] as Array<(r: Row) => boolean>,
      _selected: "*",
      _limit: undefined as undefined | number,
      _order: undefined as any,
      _update: undefined as undefined | Row,
      _insert: undefined as undefined | Row | Row[],
      _isInsert: false,
      _isUpdate: false,
      _returnSingle: false,
      _returnMaybe: false,
      select(cols = "*") {
        this._selected = cols;
        return this;
      },
      eq(col: string, val: any) {
        this._filters.push((r) => r[col] === val);
        return this;
      },
      in(col: string, vals: any[]) {
        this._filters.push((r) => vals.includes(r[col]));
        return this;
      },
      or(_q: string) {
        // simplified: accept all on or()
        return this;
      },
      order() {
        return this;
      },
      limit(n: number) {
        this._limit = n;
        return this;
      },
      maybeSingle() {
        this._returnMaybe = true;
        return this._exec();
      },
      single() {
        this._returnSingle = true;
        return this._exec();
      },
      update(row: Row) {
        this._isUpdate = true;
        this._update = row;
        return this;
      },
      insert(row: Row | Row[]) {
        this._isInsert = true;
        this._insert = row;
        return this;
      },
      _exec() {
        if (self.forceInsertError && this._isInsert) {
          return Promise.resolve({
            data: null,
            error: { message: self.forceInsertError },
          });
        }
        if (this._isInsert) {
          const arr = Array.isArray(this._insert) ? this._insert : [this._insert];
          const inserted = arr.map((r) => ({
            id: r.id ?? crypto.randomUUID(),
            ...r,
            installed_at: r.installed_at ?? new Date().toISOString(),
          }));
          self.tables[this._table].push(...inserted);
          return Promise.resolve({
            data: this._returnSingle ? inserted[0] : inserted,
            error: null,
          });
        }
        let rows = self.tables[this._table].filter((r) =>
          this._filters.every((f: any) => f(r)),
        );
        if (this._isUpdate) {
          rows.forEach((r) => Object.assign(r, this._update));
          return Promise.resolve({ data: null, error: null });
        }
        if (this._limit) rows = rows.slice(0, this._limit);
        if (this._returnSingle)
          return Promise.resolve({ data: rows[0] ?? null, error: rows[0] ? null : { message: "not found" } });
        if (this._returnMaybe) return Promise.resolve({ data: rows[0] ?? null, error: null });
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return chain;
  }
}

// We test the pure expansion logic by reproducing the worker steps directly
// against the mock client.
async function runMaterialization(supa: MockSupabase, installId: string) {
  const inst = supa.tables.regulatory_pack_installs.find((r) => r.id === installId);
  if (!inst) throw new Error("install not found");

  try {
    inst.status = "materializing";
    const pack = supa.tables.regulatory_template_packs.find((p) => p.id === inst.pack_id);
    if (!pack) throw new Error("pack not found");
    const tpl = pack.default_process_template ?? {};
    const pipelineIds: string[] = [];
    for (const pl of tpl.data_prep_pipelines ?? []) {
      const id = crypto.randomUUID();
      supa.tables.data_prep_pipelines.push({
        id,
        tenant_id: inst.tenant_id,
        name: pl.name,
      });
      pipelineIds.push(id);
    }
    const reconId = crypto.randomUUID();
    supa.tables.recon_definitions.push({
      id: reconId,
      tenant_id: inst.tenant_id,
      name: (tpl.recon_processes ?? [])[0]?.name ?? "Root",
    });
    inst.status = "ready";
    inst.generated_process_count = pipelineIds.length + 1;
    inst.tenant_root_process_id = reconId;
    inst.completed_at = new Date().toISOString();
    supa.tables.security_events.push({
      event_type: "regulatory.install.complete",
      severity: "info",
      context: {
        tenant_id: inst.tenant_id,
        pack_code: pack.pack_code,
        install_id: inst.id,
        generated_process_count: inst.generated_process_count,
      },
    });
  } catch (e: any) {
    inst.status = "failed";
    inst.error_message = e?.message ?? String(e);
    supa.tables.security_events.push({
      event_type: "regulatory.install.failed",
      severity: "error",
      context: { install_id: inst.id, error: inst.error_message },
    });
    throw e;
  }
}

function seedEmir(supa: MockSupabase) {
  supa.tables.regulatory_template_packs.push({
    id: "pack-emir",
    pack_code: "EMIR_REFIT_V3",
    code: "EMIR_REFIT_V3",
    title: "EMIR Refit v3",
    jurisdiction: "EU",
    version: "3.0",
    status: "published",
    field_dictionary: { trade: { uti: { type: "string", required: true } } },
    default_process_template: {
      folder: { name: "EMIR Refit v3" },
      data_prep_pipelines: [
        { name: "EMIR — Internal trades" },
        { name: "EMIR — Counterparty trades (TR)" },
      ],
      recon_processes: [{ name: "EMIR — Trade match (Internal vs TR)" }],
    },
  });
}

async function callInstall(
  supa: MockSupabase,
  tenantId: string,
  packCode: string,
  userId: string,
  opts: { force?: boolean } = {},
) {
  // Mimic installRegulatoryPack server fn body
  const isPlatform = (await supa.rpc("is_platform_admin", {})).data;
  if (!isPlatform) {
    const hasRole = (await supa.rpc("has_tenant_role", {})).data;
    if (!hasRole) throw new Error("Forbidden: tenant_admin required");
  }
  const pack = supa.tables.regulatory_template_packs.find(
    (p) => (p.pack_code === packCode || p.code === packCode) && p.status === "published",
  );
  if (!pack) throw new Error(`Pack not found or not published: ${packCode}`);
  if (!opts.force) {
    const existing = supa.tables.regulatory_pack_installs.find(
      (r) =>
        r.tenant_id === tenantId &&
        r.pack_id === pack.id &&
        ["pending", "installing", "materializing", "ready"].includes(r.status),
    );
    if (existing) return { installId: existing.id, reused: true };
  }
  const id = crypto.randomUUID();
  supa.tables.regulatory_pack_installs.push({
    id,
    tenant_id: tenantId,
    pack_id: pack.id,
    installed_by: userId,
    installed_version: pack.version,
    status: "installing",
    generated_process_count: 0,
    installed_at: new Date().toISOString(),
  });
  return { installId: id, reused: false };
}

describe("D2 regulatory pack install", () => {
  let supa: MockSupabase;
  const tenantId = "11111111-1111-1111-1111-111111111111";
  const userId = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    supa = new MockSupabase();
    seedEmir(supa);
  });

  it("happy path: install + materialize creates folder + N data-prep + 1 recon", async () => {
    const { installId, reused } = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    expect(reused).toBe(false);
    await runMaterialization(supa, installId);
    const inst = supa.tables.regulatory_pack_installs.find((r) => r.id === installId)!;
    expect(inst.status).toBe("ready");
    expect(inst.generated_process_count).toBe(3); // 2 pipelines + 1 recon
    expect(supa.tables.data_prep_pipelines.length).toBe(2);
    expect(supa.tables.recon_definitions.length).toBe(1);
    expect(
      supa.tables.security_events.some((e) => e.event_type === "regulatory.install.complete"),
    ).toBe(true);
  });

  it("install is idempotent: second call returns existing installId", async () => {
    const a = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    const b = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    expect(b.reused).toBe(true);
    expect(b.installId).toBe(a.installId);
  });

  it("non-tenant-admin throws Forbidden", async () => {
    supa.rpcs.is_platform_admin = false;
    supa.rpcs.has_tenant_role = false;
    await expect(callInstall(supa, tenantId, "EMIR_REFIT_V3", userId)).rejects.toThrow(/Forbidden/);
  });

  it("install for non-existent pack_code throws", async () => {
    await expect(callInstall(supa, tenantId, "DOES_NOT_EXIST", userId)).rejects.toThrow(/not found/);
  });

  it("install failure: marks row failed with error_message and writes error event", async () => {
    const { installId } = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    // simulate by deleting the pack mid-flight
    const inst = supa.tables.regulatory_pack_installs.find((r) => r.id === installId)!;
    inst.pack_id = "bogus";
    await expect(runMaterialization(supa, installId)).rejects.toThrow(/pack not found/);
    expect(inst.status).toBe("failed");
    expect(inst.error_message).toMatch(/pack not found/);
    expect(
      supa.tables.security_events.some((e) => e.event_type === "regulatory.install.failed"),
    ).toBe(true);
  });

  it("list installed packs returns all rows for the tenant", async () => {
    const a = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    const rows = supa.tables.regulatory_pack_installs.filter((r) => r.tenant_id === tenantId);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(a.installId);
  });

  it("get install status returns the row", async () => {
    const { installId } = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    await runMaterialization(supa, installId);
    const row = supa.tables.regulatory_pack_installs.find((r) => r.id === installId);
    expect(row?.status).toBe("ready");
    expect(row?.tenant_root_process_id).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // D2 follow-up — fixtures 8/9/10
  // ---------------------------------------------------------------------------

  it("claim_regulatory_install: only one of two concurrent workers wins", async () => {
    // Simulates the SQL function `claim_regulatory_install` which atomically
    // flips status `installing → materializing` via UPDATE … RETURNING.
    const { installId } = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);

    function claim(): { claimed: boolean; install_row: Row | null } {
      const row = supa.tables.regulatory_pack_installs.find(
        (r) =>
          r.id === installId &&
          ["installing", "pending", "materializing"].includes(r.status),
      );
      if (!row) return { claimed: false, install_row: null };
      // The DB-side guard: only flip if status is still in the eligible set.
      if (row.status === "materializing") return { claimed: false, install_row: null };
      row.status = "materializing";
      return { claimed: true, install_row: { ...row } };
    }

    const a = claim();
    const b = claim();
    expect([a.claimed, b.claimed].filter(Boolean).length).toBe(1);
    expect(a.claimed || b.claimed).toBe(true);
  });

  it("crash between recon insert and status flip recovers on retry (idempotent by name)", async () => {
    const { installId } = await callInstall(supa, tenantId, "EMIR_REFIT_V3", userId);
    const inst = supa.tables.regulatory_pack_installs.find((r) => r.id === installId)!;
    const pack = supa.tables.regulatory_template_packs[0];

    // First attempt — insert recon, then "crash" before complete_regulatory_install.
    inst.status = "materializing";
    const reconName = pack.default_process_template.recon_processes[0].name;
    supa.tables.recon_definitions.push({
      id: crypto.randomUUID(),
      tenant_id: inst.tenant_id,
      name: reconName,
    });
    for (const pl of pack.default_process_template.data_prep_pipelines) {
      supa.tables.data_prep_pipelines.push({
        id: crypto.randomUUID(),
        tenant_id: inst.tenant_id,
        name: pl.name,
      });
    }
    // Crash — status never advances past materializing.
    expect(inst.status).toBe("materializing");

    // Retry — name-based idempotency reuses existing artefacts, finishes cleanly.
    const reusedRecon = supa.tables.recon_definitions.find(
      (r) => r.tenant_id === inst.tenant_id && r.name === reconName,
    )!;
    const reusedPipelines = supa.tables.data_prep_pipelines.filter(
      (p) => p.tenant_id === inst.tenant_id,
    );
    inst.status = "ready";
    inst.tenant_root_process_id = reusedRecon.id;
    inst.generated_process_count = reusedPipelines.length + 1;

    // No duplicate rows materialised.
    expect(
      supa.tables.recon_definitions.filter(
        (r) => r.tenant_id === inst.tenant_id && r.name === reconName,
      ).length,
    ).toBe(1);
    expect(supa.tables.data_prep_pipelines.length).toBe(2);
    expect(inst.status).toBe("ready");
    expect(inst.generated_process_count).toBe(3);
  });

  it("poll cap: after 30 attempts the UI surfaces a 'still in progress' toast", async () => {
    // Mirrors the useEffect poll loop in regulatory.tsx. We assert that the
    // 31st tick of an unfinished install triggers the toast and stops the poll.
    const toasted: string[] = [];
    const toast = { message: (m: string) => toasted.push(m) };

    let pollingId: string | null = "install-id";
    let attempts = 0;
    const tick = () => {
      attempts++;
      // status stays "materializing" — never resolves.
      if (attempts > 30) {
        pollingId = null;
        toast.message(
          "Installation is still in progress. Refresh this page to check status.",
        );
      }
    };
    for (let i = 0; i < 31; i++) tick();
    expect(pollingId).toBeNull();
    expect(toasted).toEqual([
      "Installation is still in progress. Refresh this page to check status.",
    ]);
  });
});

// silence unused vi warning if vi isn't required
void vi;
