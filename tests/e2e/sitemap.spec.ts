import { test, expect } from "@playwright/test";

/**
 * /sitemap.xml smoke test.
 *
 * The sitemap is generated from src/routes/sitemap[.]xml.ts which reads
 * support categories via getSupportCategories(). After LL-016, this
 * route was a 500 — this test guards against regression.
 */

test("GET /sitemap.xml returns 200 with valid XML", async ({ request }) => {
  const resp = await request.get("/sitemap.xml");
  expect(
    resp.status(),
    `/sitemap.xml expected 200, got ${resp.status()}`,
  ).toBe(200);

  const ct = resp.headers()["content-type"] ?? "";
  expect(
    /xml/i.test(ct),
    `sitemap content-type expected XML, got "${ct}"`,
  ).toBeTruthy();

  const text = await resp.text();

  // Must look like a real XML sitemap.
  expect(text).toMatch(/<\?xml/i);
  expect(text).toMatch(/<urlset/i);
  expect(text).toMatch(/<\/urlset>/i);

  // Must contain at least one <url>...</url> block.
  expect(text).toMatch(/<url>[\s\S]*<\/url>/i);
});

test("/sitemap.xml includes marketing pages", async ({ request }) => {
  const resp = await request.get("/sitemap.xml");
  if (resp.status() !== 200) test.skip(true, `sitemap returned ${resp.status()}`);

  const text = await resp.text();
  // Marketing routes — must be discoverable.
  expect(text).toMatch(/<loc>[^<]*\/<\/loc>/i);
  expect(text).toMatch(/<loc>[^<]*\/pricing<\/loc>/i);
});

test("/sitemap.xml includes support articles", async ({ request }) => {
  const resp = await request.get("/sitemap.xml");
  if (resp.status() !== 200) test.skip(true, `sitemap returned ${resp.status()}`);

  const text = await resp.text();
  // The support content lives under /support/<category>/<article>.
  // At least one such URL must be present (LL-016 fix path).
  expect(
    /<loc>[^<]*\/support\/[^<]+<\/loc>/i.test(text),
    `no /support/* URLs in sitemap`,
  ).toBeTruthy();
});
