import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [originValue, expectedRef, publishableOutputValue, sentinelOutputValue] = process.argv.slice(2);
const origin = new URL(originValue ?? "");
if (origin.protocol !== "https:" || !origin.hostname.endsWith(".reconiq.example")) {
  throw new Error("Origin must be a canonical ReconIQ HTTPS host");
}
if (!/^[a-z]{20}$/u.test(expectedRef ?? "")) throw new Error("Expected project reference is invalid");
const publishableOutput = path.resolve(publishableOutputValue ?? "");
const sentinelOutput = path.resolve(sentinelOutputValue ?? "");
if (!publishableOutputValue || !sentinelOutputValue) throw new Error("Two protected output paths are required");

const root = await fetch(origin);
if (!root.ok) throw new Error(`Application root failed with HTTP ${root.status}`);
const html = await root.text();
const sources = [...new Set([...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map((match) => match[1]))];
const scripts = await Promise.all(sources.map(async (source) => {
  const response = await fetch(new URL(source, origin));
  if (!response.ok) throw new Error(`Client script failed with HTTP ${response.status}`);
  return response.text();
}));
const relevant = scripts.filter((script) => script.includes(`${expectedRef}.supabase.co`));
const candidates = new Set();
for (const script of relevant) {
  for (const match of script.matchAll(/sb_publishable_[A-Za-z0-9._-]{20,}/gu)) candidates.add(match[0]);
  for (const match of script.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"));
      if (payload?.role === "anon" && payload?.ref === expectedRef) candidates.add(match[0]);
    } catch { /* not a decodable Supabase JWT */ }
  }
}
if (candidates.size !== 1) throw new Error(`Expected one deployed publishable key, found ${candidates.size}`);
const publishable = [...candidates][0];
const sentinel = `fvi_build_sentinel_${randomBytes(32).toString("hex")}`;
await Promise.all([
  mkdir(path.dirname(publishableOutput), { recursive: true }),
  mkdir(path.dirname(sentinelOutput), { recursive: true }),
]);
await Promise.all([
  writeFile(publishableOutput, publishable, { encoding: "utf8", mode: 0o600 }),
  writeFile(sentinelOutput, sentinel, { encoding: "utf8", mode: 0o600 }),
]);
console.log(JSON.stringify({
  ok: true,
  expectedRef,
  scriptsChecked: scripts.length,
  publishableFingerprint: createHash("sha256").update(publishable).digest("hex").slice(0, 12),
  protectedOutputsWritten: 2,
}));
