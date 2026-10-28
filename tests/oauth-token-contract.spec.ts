import { afterEach, describe, expect, it } from "vitest";

import { Route } from "../src/routes/api/public/oauth/token";

const originalSigningSecret = process.env.SANDBOX_JWT_SIGNING_SECRET;
const originalAliasSecret = process.env.SANDBOX_JWT_SECRET;

function post(body: string, origin?: string) {
  const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
  if (origin) headers.set("origin", origin);
  return new Request("https://app.reconiq.example/api/public/oauth/token", {
    method: "POST",
    headers,
    body,
  });
}

function handler(method: "POST" | "OPTIONS") {
  const route = Route as unknown as {
    options: { server: { handlers: Record<string, unknown> } };
  };
  return route.options.server.handlers[method] as (context: {
    request: Request;
  }) => Promise<Response>;
}

afterEach(() => {
  if (originalSigningSecret === undefined) delete process.env.SANDBOX_JWT_SIGNING_SECRET;
  else process.env.SANDBOX_JWT_SIGNING_SECRET = originalSigningSecret;
  if (originalAliasSecret === undefined) delete process.env.SANDBOX_JWT_SECRET;
  else process.env.SANDBOX_JWT_SECRET = originalAliasSecret;
});

describe("OAuth client-credentials endpoint contract", () => {
  it("rejects malformed requests before resolving the signing secret", async () => {
    delete process.env.SANDBOX_JWT_SIGNING_SECRET;
    delete process.env.SANDBOX_JWT_SECRET;

    const unsupported = await handler("POST")({ request: post("grant_type=password") });
    expect(unsupported.status).toBe(400);
    await expect(unsupported.json()).resolves.toMatchObject({
      error: "unsupported_grant_type",
    });

    const missingCredentials = await handler("POST")({
      request: post("grant_type=client_credentials", "https://app.reconiq.example"),
    });
    expect(missingCredentials.status).toBe(400);
    expect(missingCredentials.headers.get("access-control-allow-origin")).toBe(
      "https://app.reconiq.example",
    );
    await expect(missingCredentials.json()).resolves.toMatchObject({
      error: "invalid_request",
    });
  });

  it("allows current PROD and DEV browser origins", async () => {
    for (const origin of ["https://app.reconiq.example", "https://dev.app.reconiq.example"]) {
      const request = new Request("https://app.reconiq.example/api/public/oauth/token", {
        method: "OPTIONS",
        headers: { origin },
      });
      const response = await handler("OPTIONS")({ request });
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    }
  });

  it("does not reflect an unapproved browser origin", async () => {
    const request = new Request("https://app.reconiq.example/api/public/oauth/token", {
      method: "OPTIONS",
      headers: { origin: "https://attacker.example" },
    });
    const response = await handler("OPTIONS")({ request });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("fails closed with retryable JSON when valid-looking requests lack signing material", async () => {
    delete process.env.SANDBOX_JWT_SIGNING_SECRET;
    delete process.env.SANDBOX_JWT_SECRET;

    const response = await handler("POST")({
      request: post("grant_type=client_credentials&client_id=probe&client_secret=probe"),
    });
    expect(response.status).toBe(503);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("retry-after")).toBe("300");
    await expect(response.json()).resolves.toEqual({
      error: "temporarily_unavailable",
      error_description: "OAuth token issuance is temporarily unavailable",
    });
  });
});
