// Public GETs only. Save structure/metadata/digests, never article bodies or images.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const base = "https://support.du.co/api/v2/help_center/en-us";
const calls = [];
async function pages(url, key) {
  const records = [];
  const seen = new Set();
  while (url) {
    if (seen.has(url)) throw new Error("Repeated pagination URL");
    seen.add(url);
    await new Promise((done) => setTimeout(done, 400));
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    calls.push({ url, status: response.status, visited_at: new Date().toISOString() });
    if (!response.ok) throw new Error(`Public listing failed: ${response.status} ${url}`);
    const json = await response.json();
    if (!Array.isArray(json[key])) throw new Error(`Missing ${key} listing`);
    records.push(...json[key]);
    url = json.next_page;
  }
  return records;
}
const categories = await pages(`${base}/categories.json?per_page=100`, "categories");
const sections = await pages(`${base}/sections.json?per_page=100`, "sections");
const articles = await pages(`${base}/articles.json?per_page=100`, "articles");
const count = (body, regex) => [...body.matchAll(regex)].length;
const review = articles.map((article) => {
  const body = article.body ?? "";
  const section = sections.find((candidate) => candidate.id === article.section_id);
  const category = categories.find((candidate) => candidate.id === section?.category_id);
  const plain = body.replace(/<[^>]*>/gu, " ");
  return {
    id: article.id, title: article.title, url: article.html_url,
    category: category?.name ?? null, section: section?.name ?? null,
    parent_section_id: section?.parent_section_id ?? null,
    updated_at: article.updated_at,
    body_sha256: createHash("sha256").update(body).digest("hex"),
    body_characters: body.length,
    headings: count(body, /<h[1-6]\b/giu),
    tables: count(body, /<table\b/giu),
    ordered_lists: count(body, /<ol\b/giu),
    code_blocks: count(body, /<(?:pre|code)\b/giu),
    image_references: count(body, /<img\b/giu),
    hyperlinks: count(body, /<a\b/giu),
    prerequisite_terms: /before you start|prerequisite|what you will need/iu.test(plain),
    permission_terms: /permission|authoriz|authentication|access token/iu.test(plain),
    api_related: /\bAPI\b|Swagger|REST|OAuth|webhook/iu.test(`${article.title} ${plain}`),
  };
});
const output = "docs/research/DUCO_API_BRANCH_STRUCTURE_REVIEW_2026-10-02.json";
const summary = {
  owner: "Helmholtz — Enterprise API documentation preparation",
  scope: "Public en-us article-body structural review; no protected-page access, article-text or image persistence",
  captured_at: new Date().toISOString(),
  calls,
  counts: { categories: categories.length, sections: sections.length, articles: review.length, nested_sections: sections.filter((section) => section.parent_section_id).length, api_related_articles: review.filter((article) => article.api_related).length },
  categories: categories.map((category) => ({ id: category.id, name: category.name, url: category.html_url, sections: sections.filter((section) => section.category_id === category.id).length, articles: review.filter((article) => article.category === category.name).length })),
  sections: sections.map((section) => ({ id: section.id, name: section.name, url: section.html_url, category_id: section.category_id, parent_section_id: section.parent_section_id, articles: review.filter((article) => article.section === section.name && article.category === categories.find((category) => category.id === section.category_id)?.name).length })),
  structure: { with_headings: review.filter((article) => article.headings).length, with_tables: review.filter((article) => article.tables).length, with_ordered_lists: review.filter((article) => article.ordered_lists).length, with_code: review.filter((article) => article.code_blocks).length, with_images: review.filter((article) => article.image_references).length, with_prerequisites: review.filter((article) => article.prerequisite_terms).length, with_permission_terms: review.filter((article) => article.permission_terms).length },
  articles: review,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
console.log(JSON.stringify({ output, counts: summary.counts, structure: summary.structure, references: review.filter((article) => /API|reporting database schema|September 2026/iu.test(article.title)).map(({ title, url, category, section }) => ({ title, url, category, section })) }, null, 2));
