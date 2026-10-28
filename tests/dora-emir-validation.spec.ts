import { describe, it, expect } from "vitest";
import { validateDoraRegister, validateEmirMapping, EMIR_DEFAULT_MAPPING } from "@/lib/dora-validate";

const inFuture = (days: number) => new Date(Date.now() + days * 86400_000).toISOString().slice(0, 10);

describe("DORA register validation", () => {
  it("flags missing required fields for a Falcon provider", () => {
    const r = validateDoraRegister([
      { id: "r1", provider_name: "Citibank N.A.", service_description: null, criticality: "critical", country: "US", contract_start: "2024-01-01", contract_end: inFuture(365), status: "active", data_processed: null, subcontractors_json: [{ name: "AWS" }] },
    ]);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.issues.some((i) => i.field === "service_description")).toBe(true);
    expect(r.audit_ready).toBe(false);
  });

  it("warns when a critical provider has no subcontractors documented", () => {
    const r = validateDoraRegister([
      { id: "r1", provider_name: "Citibank N.A.", service_description: "Falcon Nostro USD", criticality: "critical", country: "US", contract_start: "2024-01-01", contract_end: inFuture(365), status: "active", data_processed: null, subcontractors_json: [] },
    ]);
    expect(r.warnings).toBeGreaterThan(0);
    expect(r.issues.some((i) => i.field === "subcontractors_json")).toBe(true);
  });

  it("errors on expired contract and is audit-ready otherwise", () => {
    const expired = validateDoraRegister([
      { id: "r1", provider_name: "ACME", service_description: "x", criticality: "important", country: "US", contract_start: "2020-01-01", contract_end: "2021-01-01", status: "active", data_processed: null, subcontractors_json: null },
    ]);
    expect(expired.errors).toBeGreaterThan(0);

    const ok = validateDoraRegister([
      { id: "r1", provider_name: "Citibank N.A.", service_description: "Falcon Nostro USD", criticality: "important", country: "US", contract_start: "2024-01-01", contract_end: inFuture(365), status: "active", data_processed: null, subcontractors_json: null },
    ]);
    expect(ok.errors).toBe(0);
    expect(ok.audit_ready).toBe(true);
  });

  it("warns when country is not a 2-letter ISO code", () => {
    const r = validateDoraRegister([
      { id: "r1", provider_name: "Citibank", service_description: "x", criticality: "important", country: "United States", contract_start: "2024-01-01", contract_end: inFuture(365), status: "active", data_processed: null, subcontractors_json: null },
    ]);
    expect(r.issues.some((i) => i.field === "country")).toBe(true);
  });
});

describe("EMIR Refit mapping validation", () => {
  it("default mapping is audit-ready", () => {
    const r = validateEmirMapping(EMIR_DEFAULT_MAPPING);
    expect(r.audit_ready).toBe(true);
    expect(r.errors).toBe(0);
  });

  it("errors when a required field has no source_path", () => {
    const mapping = EMIR_DEFAULT_MAPPING.map((m, i) => i === 0 ? { ...m, source_path: "" } : m);
    const r = validateEmirMapping(mapping);
    expect(r.errors).toBeGreaterThan(0);
    expect(r.audit_ready).toBe(false);
  });

  it("warns when source_path is not a dotted path", () => {
    const mapping = EMIR_DEFAULT_MAPPING.map((m, i) => i === 0 ? { ...m, source_path: "not a path!" } : m);
    const r = validateEmirMapping(mapping);
    expect(r.warnings).toBeGreaterThan(0);
  });
});
