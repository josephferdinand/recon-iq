import { describe, it, expect } from "vitest";
import { parseHost } from "@/lib/tenant-host.functions";

describe("parseHost — subdomain & custom domain routing", () => {
  it("resolves apex marketing host", () => {
    expect(parseHost("reconiq.example")).toMatchObject({ kind: "marketing", slug: null });
    expect(parseHost("www.reconiq.example")).toMatchObject({ kind: "marketing" });
  });

  it("resolves platform host", () => {
    expect(parseHost("app.reconiq.example")).toMatchObject({ kind: "platform", slug: null });
  });

  it("resolves tenant prod subdomains", () => {
    expect(parseHost("jpmc.reconiq.example")).toMatchObject({ kind: "tenant", slug: "jpmc", env: "prod" });
  });

  it("resolves tenant -dev / -sandbox / -uat suffixes", () => {
    expect(parseHost("citi-dev.reconiq.example")).toMatchObject({ kind: "tenant", slug: "citi", env: "dev" });
    expect(parseHost("hsbc-sandbox.reconiq.example")).toMatchObject({ kind: "tenant", slug: "hsbc", env: "sandbox" });
    expect(parseHost("bofa-uat.reconiq.example")).toMatchObject({ kind: "tenant", slug: "bofa", env: "uat" });
  });

  it("strips ports and is case-insensitive", () => {
    expect(parseHost("JPMC.ReconIQ.com:443")).toMatchObject({ slug: "jpmc", env: "prod" });
  });

  it("returns 'unknown' for non-falcon hosts (used as custom domain hint)", () => {
    // Custom BYO domains don't end in reconiq.example; the server-side
    // resolveHost() then performs a DB lookup against tenant_custom_domains.
    expect(parseHost("recon.bank.com")).toMatchObject({ kind: "unknown", slug: null });
  });

  it("treats localhost / meta preview as platform", () => {
    expect(parseHost("localhost")).toMatchObject({ kind: "platform" });
    expect(parseHost("id-preview--xxx.meta.app")).toMatchObject({ kind: "platform" });
  });
});
