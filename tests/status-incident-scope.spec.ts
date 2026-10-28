import { it, expect } from "vitest";
import { incidentFunctionOptions } from "@/lib/status-incident-scope";
const rows = [
  { cell_key: "prod", component_key: "recon", function_key: "recon.run", function_label: "Reconciliation run", availability: "unverified" },
  { cell_key: "dev", component_key: "recon", function_key: "recon.run", function_label: "Reconciliation run", availability: "unverified" },
  { cell_key: "prod", component_key: "api", function_key: "api.read", function_label: "API read", availability: "deployed" },
];
it("restricts new choices to actual function registrations common to every selected scope and service", () => {
  expect(incidentFunctionOptions(rows, ["prod", "dev"], ["recon", "api"], [])).toEqual([{ key: "recon.run", label: "Reconciliation run", available: true }]);
  expect(incidentFunctionOptions(rows, ["dev"], ["api"], [])).toEqual([]);
});
it("keeps historical selections visible and unavailable instead of removing their record", () => {
  expect(incidentFunctionOptions(rows, ["dev"], ["recon"], ["api.read"])).toContainEqual({ key: "api.read", label: "api.read — not registered across the selected scope", available: false });
});
