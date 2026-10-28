import { expect, test } from "@playwright/test";

const baseURL = process.env.FVI_E2E_BASE_URL ?? "https://dev.app.reconiq.example";
const allowedOrigin = process.env.FVI_E2E_ALLOWED_ORIGIN ?? new URL(baseURL).origin;
const oauthPath = "/api/public/oauth/token";

test("OAuth preflight allows the active FVI origin", async ({ request }) => {
  const response = await request.fetch(oauthPath, {
    method: "OPTIONS",
    headers: {
      Origin: allowedOrigin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  expect(response.status()).toBe(204);
  expect(response.headers()["access-control-allow-origin"]).toBe(allowedOrigin);
  expect(response.headers()["access-control-allow-methods"]).toContain("POST");
});

test("OAuth rejects malformed requests before runtime secret lookup", async ({ request }) => {
  const response = await request.post(oauthPath, {
    headers: {
      Origin: allowedOrigin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    form: { grant_type: "client_credentials" },
  });

  expect(response.status()).toBe(400);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["access-control-allow-origin"]).toBe(allowedOrigin);
  await expect(response.json()).resolves.toMatchObject({ error: "invalid_request" });
});

test("OAuth fails closed with a machine-readable runtime configuration response", async ({
  request,
}) => {
  const response = await request.post(oauthPath, {
    headers: {
      Origin: allowedOrigin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    form: {
      grant_type: "client_credentials",
      client_id: "aaaaaaaaaaaaaaaa",
      client_secret: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    },
  });

  // Current PROD and DEV intentionally have no OAuth signing runtime. If the
  // owner later provisions one, invalid client credentials must still fail.
  expect([401, 503]).toContain(response.status());
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(response.headers()["access-control-allow-origin"]).toBe(allowedOrigin);

  const body = await response.json();
  if (response.status() === 503) {
    expect(body).toMatchObject({ error: "temporarily_unavailable" });
    expect(response.headers()["retry-after"]).toBe("300");
  } else {
    expect(body).toMatchObject({ error: "invalid_client" });
  }
});

test("hostile origins never receive OAuth CORS permission", async ({ request }) => {
  const response = await request.post(oauthPath, {
    headers: {
      Origin: "https://hostile.example",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    form: { grant_type: "client_credentials" },
  });

  expect(response.status()).toBe(400);
  expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("SCIM and cron surfaces reject missing credentials", async ({ request }) => {
  const scim = await request.get("/api/public/scim/v2/Users");
  expect(scim.status()).toBe(401);
  expect(scim.headers()["content-type"]).toContain("application/scim+json");

  for (const path of [
    "/api/public/cron/audit-anchor-write",
    "/api/public/cron/audit-anchor-verify",
  ]) {
    const response = await request.post(path);
    expect(response.status()).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
  }
});
