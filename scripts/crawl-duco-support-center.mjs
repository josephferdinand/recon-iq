#!/usr/bin/env node
// Read-only, paced inventory of the public English Duco Zendesk Help Center.
// Records URL/status/metadata only; article bodies are held in memory and never saved.
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

const origin = "https://support.du.co";
const locale = "en-us";
const output = resolve(
  process.argv[2] ?? `docs/research/DUCO_SUPPORT_CENTER_VISITED_URLS_${new Date().toISOString().slice(0, 10)}.csv`,
);
if (existsSync(output)) throw new Error(`Registry already exists; preserve it and choose a new dated output before a new crawl: ${output}`);
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
const visits = [];
let htmlCompleted = 0;

async function get(url, { kind = "page", category = "", section = "", article = "", pace = true } = {}) {
  if (pace) await sleep(350);
  const started = new Date().toISOString();
  let response;
  let body = "";
  let attempts = 0;
  while (attempts < 4) {
    attempts += 1;
    try {
      response = await fetch(url, {
        headers: { accept: "application/json, text/html;q=0.9, */*;q=0.8", "user-agent": "FVI public documentation structure research" },
        redirect: "follow",
        signal: AbortSignal.timeout(30000),
      });
      body = await response.text();
    } catch (error) {
      const row = { kind, url, finalUrl: "", status: "NETWORK_ERROR", contentType: "", bytes: 0, title: "", category, section, article, attempts, started, error: error?.name ?? "Error" };
      visits.push(row);
      return { row, body: "", json: null };
    }
    if (response.status !== 429 || attempts === 4) break;
    const retryHeader = Number(response.headers.get("retry-after"));
    await sleep(Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : 5000);
  }
  const title = body.match(/<title[^>]*>([\s\S]*?)<\/title>/iu)?.[1]?.replace(/\s+/gu, " ").trim() ?? "";
  const row = {
    kind,
    url,
    finalUrl: response.url,
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    bytes: Buffer.byteLength(body),
    title,
    category,
    section,
    article,
    attempts,
    started,
    error: "",
  };
  visits.push(row);
  if (kind === "category-page" || kind === "section-page" || kind === "article-page") {
    htmlCompleted += 1;
    if (htmlCompleted % 25 === 0) console.error(`Visited ${htmlCompleted} public category/section/article pages`);
  }
  let json = null;
  if (/application\/json/iu.test(row.contentType)) {
    try { json = JSON.parse(body); } catch { /* retain status; malformed JSON is a coverage failure */ }
  }
  return { row, body, json };
}

async function collectPages(firstUrl, collectionName, kind, context = {}) {
  const records = [];
  let url = firstUrl;
  let page = 0;
  while (url) {
    page += 1;
    const { json } = await get(url, { kind: `${kind}-index`, ...context });
    if (!json || !Array.isArray(json[collectionName])) throw new Error(`Incomplete public index: ${url}`);
    records.push(...json[collectionName]);
    url = json.next_page;
    if (page > 500) throw new Error(`Pagination safety bound exceeded for ${firstUrl}`);
  }
  return records;
}

const categories = await collectPages(
  `${origin}/api/v2/help_center/${locale}/categories.json?per_page=100`,
  "categories",
  "category",
);

const sectionsByCategory = new Map();
for (const category of categories) {
  const sections = await collectPages(
    `${origin}/api/v2/help_center/${locale}/categories/${category.id}/sections.json?per_page=100`,
    "sections",
    "section",
    { category: category.name },
  );
  sectionsByCategory.set(category.id, sections);
}

const sections = await collectPages(
  `${origin}/api/v2/help_center/${locale}/sections.json?per_page=100`,
  "sections",
  "section",
);
const sectionById = new Map(sections.map((section) => [section.id, section]));

const articles = await collectPages(
  `${origin}/api/v2/help_center/${locale}/articles.json?per_page=100`,
  "articles",
  "article",
);
const sectionArticleCounts = new Map();
for (const section of sections) {
  let url = `${origin}/api/v2/help_center/${locale}/sections/${section.id}/articles.json?per_page=100`;
  let count = 0;
  while (url) {
    const { json } = await get(url, {
      kind: "section-article-index",
      category: categories.find((item) => item.id === section.category_id)?.name ?? "",
      section: section.name,
    });
    if (!json || !Array.isArray(json.articles)) throw new Error(`Incomplete section article index: ${url}`);
    count += json.articles.length;
    url = json.next_page;
    if (count > 100000) throw new Error(`Article pagination safety bound exceeded for section ${section.id}`);
  }
  sectionArticleCounts.set(section.id, count);
}

const pageTargets = [
  { url: `${origin}/hc/${locale}`, kind: "help-center-home" },
  { url: `${origin}/hc/${locale}/articles/360009239258-Where-can-I-find-documentation-on-the-API`, kind: "owner-supplied-api-entry" },
  { url: `${origin}/hc/${locale}/articles/24648868237085-API`, kind: "owner-supplied-api-reference" },
  { url: `${origin}/hc/${locale}/articles/38834795873437-September-2026-early-access-to-multi-reconciliation-view-and-data-prep-powered-reference-data-updates-faster-manual-actions-across-the-board-and-more`, kind: "september-2026-release-context" },
  { url: `${origin}/hc/${locale}/articles/38889490362909-Release-notes-September-2026-release`, kind: "september-2026-release-notes" },
  { url: `${origin}/hc/${locale}/sitemap.xml`, kind: "public-sitemap-access-check" },
  { url: "https://app.aidp.du.co/docs/index.html", kind: "linked-api-docs-v2" },
  { url: "https://app.aidp.du.co/api/docs/index.html", kind: "linked-api-docs-v3" },
];
for (const target of pageTargets) await get(target.url, { kind: target.kind });

const targets = [
  ...categories.map((item) => ({ url: item.html_url, kind: "category-page", category: item.name })),
  ...sections.map((item) => ({
    url: item.html_url,
    kind: "section-page",
    category: categories.find((candidate) => candidate.id === item.category_id)?.name ?? "",
    section: item.name,
  })),
  ...articles.map((item) => {
    const section = sectionById.get(item.section_id);
    return {
      url: item.html_url,
      kind: "article-page",
      category: categories.find((candidate) => candidate.id === section?.category_id)?.name ?? "",
      section: section?.name ?? "",
      article: item.title,
    };
  }),
];

let nextTarget = 0;
const workers = Array.from({ length: 2 }, async () => {
  while (nextTarget < targets.length) {
    const target = targets[nextTarget++];
    await get(target.url, target);
  }
});
await Promise.all(workers);

const csvEscape = (value) => `"${String(value ?? "").replace(/"/gu, '""')}"`;
const columns = ["kind", "url", "finalUrl", "status", "contentType", "bytes", "title", "category", "section", "article", "attempts", "started", "error"];
const csv = [columns.join(","), ...visits.map((row) => columns.map((column) => csvEscape(row[column])).join(","))].join("\r\n") + "\r\n";
await mkdir(dirname(output), { recursive: true });
await writeFile(output, csv, { encoding: "utf8", flag: "wx" });

const apiRows = visits.filter((row) => row.kind.endsWith("-index"));
const htmlRows = visits.filter((row) => !row.kind.endsWith("-index"));
const statusCounts = Object.fromEntries([...new Set(visits.map((row) => String(row.status)))].sort().map((status) => [status, visits.filter((row) => String(row.status) === status).length]));
const summary = {
  registry: output,
  categories: categories.length,
  sections: sections.length,
  categorySectionRows: [...sectionsByCategory.values()].reduce((sum, rows) => sum + rows.length, 0),
  articles: articles.length,
  sectionArticleRows: [...sectionArticleCounts.values()].reduce((sum, count) => sum + count, 0),
  publicPageVisits: targets.length + pageTargets.length,
  apiIndexVisits: apiRows.length,
  totalRegistryRows: visits.length,
  statusCounts,
  nestedSectionCount: sections.filter((section) => section.parent_section_id).length,
  datedArticleReferences: articles.filter((article) => /reporting database schema|erd|september 2026/i.test(article.title)).map(({ title, html_url, section_id }) => ({ title, url: html_url, section: sectionById.get(section_id)?.name ?? "" })),
};
console.log(JSON.stringify(summary, null, 2));
