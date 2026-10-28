import { describe, expect, it } from "vitest";
import {
  GatewayAuthenticationError,
  GatewayConfigurationError,
  GatewayError,
  GatewayRateLimitError,
} from "../src/lib/ai/gateway-stub.mjs";

describe("Cloudflare AI gateway compatibility stub", () => {
  it("implements the AI SDK static error guards", () => {
    expect(GatewayAuthenticationError.isInstance(new GatewayAuthenticationError("auth"))).toBe(true);
    expect(GatewayRateLimitError.isInstance({ name: "GatewayRateLimitError" })).toBe(true);
    expect(GatewayConfigurationError.isInstance(new Error("other"))).toBe(false);
    expect(GatewayError.isInstance(new GatewayError("gateway"))).toBe(true);
  });
});
