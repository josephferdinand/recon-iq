import { describe, expect, it } from "vitest";

import {
  computeLoginRisk,
  haversineKm,
  type LoginEvent,
} from "@/lib/security/login-risk";

const LON: LoginEvent["location"] = { latitude: 51.5074, longitude: -0.1278, country: "GB" };
const NYC: LoginEvent["location"] = { latitude: 40.7128, longitude: -74.006, country: "US" };
const PAR: LoginEvent["location"] = { latitude: 48.8566, longitude: 2.3522, country: "FR" };

const at = (iso: string) => new Date(iso);

describe("haversineKm", () => {
  it("returns ~5570 km between London and New York", () => {
    const d = haversineKm(LON!, NYC!);
    expect(d).toBeGreaterThan(5500);
    expect(d).toBeLessThan(5700);
  });
});

describe("computeLoginRisk", () => {
  it("returns first_login when there is no prior event", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T10:00:00Z"), ip: "1.1.1.1", location: LON },
    });
    expect(r.action).toBe("allow");
    expect(r.reasons).toContain("first_login");
  });

  it("allows same-IP repeat login within an hour", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T10:30:00Z"), ip: "1.1.1.1", location: LON },
      prior:   { at: at("2026-07-16T10:00:00Z"), ip: "1.1.1.1", location: LON },
    });
    expect(r.action).toBe("allow");
    expect(r.riskScore).toBe(0);
  });

  it("flags impossible travel — London to New York in 10 minutes", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T10:10:00Z"), ip: "2.2.2.2", location: NYC },
      prior:   { at: at("2026-07-16T10:00:00Z"), ip: "1.1.1.1", location: LON },
    });
    expect(r.impossibleTravel).toBe(true);
    expect(r.action).toBe("block");
    expect(r.riskScore).toBe(100);
    expect(r.reasons).toContain("impossible_travel");
  });

  it("allows plausible travel — London to Paris in 3 hours", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T13:00:00Z"), ip: "2.2.2.2", location: PAR },
      prior:   { at: at("2026-07-16T10:00:00Z"), ip: "1.1.1.1", location: LON },
    });
    expect(r.impossibleTravel).toBe(false);
    // Country change but not impossible: step_up.
    expect(r.action).toBe("step_up");
    expect(r.reasons).toContain("country_change");
  });

  it("blocks any distance in zero elapsed time", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T10:00:00Z"), ip: "2.2.2.2", location: NYC },
      prior:   { at: at("2026-07-16T10:00:00Z"), ip: "1.1.1.1", location: LON },
    });
    expect(r.impossibleTravel).toBe(true);
    expect(r.action).toBe("block");
  });

  it("adds user_agent_change reason when UA differs", () => {
    const r = computeLoginRisk({
      current: { at: at("2026-07-16T10:05:00Z"), ip: "1.1.1.1", location: LON, userAgent: "ua-new" },
      prior:   { at: at("2026-07-16T10:00:00Z"), ip: "2.2.2.2", location: LON, userAgent: "ua-old" },
    });
    expect(r.reasons).toContain("user_agent_change");
  });
});
