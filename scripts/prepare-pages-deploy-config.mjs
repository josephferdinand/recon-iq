import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const target = process.argv[2];
const sources = {
  production: "wrangler.jsonc",
  staging: "wrangler.staging.jsonc",
};
const source = sources[target];
if (!source) throw new Error("Usage: node scripts/prepare-pages-deploy-config.mjs <production|staging>");

const destination = resolve("dist/_worker.js/wrangler.json");
if (!existsSync(destination)) throw new Error("Build output is missing; run the target build first");

const raw = readFileSync(resolve(source), "utf8");
// Both deployment sources are JSONC. They intentionally use comments and
// trailing commas accepted by Wrangler, so normalize those constructs before
// emitting Nitro's strict JSON deployment config.
const config = JSON.parse(
  raw
    .replace(/^\s*\/\/.*$/gmu, "")
    .replace(/,\s*([}\]])/gu, "$1"),
);
config.pages_build_output_dir = "..";
writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  target,
  project: config.name,
  r2_bindings: (config.r2_buckets ?? []).map((binding) => ({
    binding: binding.binding,
    bucket_name: binding.bucket_name,
  })),
}));
