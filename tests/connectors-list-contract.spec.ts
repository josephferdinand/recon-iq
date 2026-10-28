import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CONNECTOR_TYPES,
  connectorExecutionMode,
  normalizeScheduleSearch,
  scheduleListOrder,
} from "@/lib/connectors.functions";

const connectorFunctions = readFileSync("src/lib/connectors.functions.ts", "utf8");
const connectorsComponent = readFileSync("src/components/connectors-tab.tsx", "utf8");

describe("scheduled connector list contract", () => {
  it("searches only normalized text suitable for a PostgREST OR expression", () => {
    expect(normalizeScheduleSearch("  SFTP,(prod)%\\test_  ")).toBe("SFTP prod test");
    expect(normalizeScheduleSearch("   ")).toBe("");
  });

  it("whitelists stable list sort fields and directions", () => {
    expect(scheduleListOrder("name_asc")).toEqual({ column: "name", ascending: true });
    expect(scheduleListOrder("name_desc")).toEqual({ column: "name", ascending: false });
    expect(scheduleListOrder("updated_desc")).toEqual({ column: "updated_at", ascending: false });
    expect(scheduleListOrder("attempt_desc")).toEqual({
      column: "last_run_at",
      ascending: false,
      nullsFirst: false,
    });
  });

  it("derives agent requirement from the existing connector execution contract", () => {
    const agentTypes = CONNECTOR_TYPES.filter(
      (type) => connectorExecutionMode(type) === "agent_required",
    );
    expect(agentTypes).toEqual(["sftp", "ftp", "local", "network_drive"]);
    expect(connectorExecutionMode("https")).toBe("direct");
    expect(connectorExecutionMode("s3")).toBe("remote_gateway");
  });

  it("fails closed when the paged list does not return an exact count and breaks sort ties by id", () => {
    const pageList = connectorFunctions.match(
      /export const listSchedulesPage[\s\S]*?export const getScheduleForEdit/u,
    )?.[0] ?? "";
    expect(pageList).toContain('typeof count !== "number"');
    expect(pageList).toMatch(/\.order\("id",\s*\{\s*ascending: true\s*\}\)\s*\.range\(/u);
    expect(pageList).toContain("rows.map(projectScheduleSummary)");
  });

  it("does not present a failed list query as an empty zero-count result", () => {
    expect(connectorsComponent).toContain('q.isError ? "Connection count unavailable"');
    expect(connectorsComponent).toContain('q.isError ? "Page unavailable"');
  });
});
