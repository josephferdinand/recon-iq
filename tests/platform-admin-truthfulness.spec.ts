import { describe, expect, it } from "vitest";
import { OPS_CONSOLE_LINKS, PLATFORM_PAGE_KEYS } from "@/lib/platform-ops-links";
import {
  PLATFORM_RUNTIME_SECRETS,
  readPlatformSecretPresence,
} from "@/lib/platform-secret-status.server";
import {
  REPORT_DEFINITION_FORMATS,
  reportFormatLabel,
  runtimeReportFormat,
} from "@/lib/report-export-formats";

describe("platform administration truthfulness", () => {
  it("uses real platform search keys instead of dead hash navigation", () => {
    for (const link of Object.values(OPS_CONSOLE_LINKS)) {
      if (link.to === "/platform") {
        expect(link.search?.page).toBeTruthy();
        expect(PLATFORM_PAGE_KEYS.has(link.search!.page)).toBe(true);
      } else {
        expect(link.to).toBe("/platform-backup");
        expect(link.search).toBeUndefined();
      }
    }
  });

  it("returns secret presence without returning secret values", () => {
    const present = new Set(["APP_DATA_ENC_KEY", "SLA_CRON_HMAC"]);
    const result = readPlatformSecretPresence((name) =>
      present.has(name) ? "never-return-this-value" : undefined,
    );

    expect(result).toHaveLength(PLATFORM_RUNTIME_SECRETS.length);
    expect(result.find((item) => item.name === "APP_DATA_ENC_KEY")?.configured).toBe(true);
    expect(result.find((item) => item.name === "FVI_AI_API_KEY")?.configured).toBe(false);
    expect(JSON.stringify(result)).not.toContain("never-return-this-value");
  });

  it("advertises only formats produced by the Worker", () => {
    expect(REPORT_DEFINITION_FORMATS).toEqual(["csv", "json"]);
    expect(runtimeReportFormat("json")).toBe("json");
    expect(runtimeReportFormat("csv")).toBe("csv");
    expect(runtimeReportFormat("pdf")).toBe("csv");
    expect(runtimeReportFormat("xlsx")).toBe("csv");
    expect(reportFormatLabel("pdf")).toContain("legacy PDF");
  });
});
