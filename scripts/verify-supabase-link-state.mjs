import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_REF_PATTERN = /^[a-z]{20}$/;

export function extractSupabaseProjectRefs(value) {
  const refs = new Set();
  const patterns = [/db\.([a-z]{20})\.supabase\.co/giu, /postgres\.([a-z]{20})(?=[:@/])/giu];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) refs.add(match[1].toLowerCase());
  }

  return [...refs].sort();
}

async function readOptionalText(file) {
  try {
    return (await readFile(file, "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function inspectSupabaseLinkState({ root = process.cwd(), expectedRef }) {
  if (!PROJECT_REF_PATTERN.test(expectedRef ?? "")) {
    throw new Error("Expected Supabase project reference must be exactly 20 lowercase letters");
  }

  const tempDirectory = path.join(root, "supabase", ".temp");
  const projectRef = await readOptionalText(path.join(tempDirectory, "project-ref"));
  const poolerValue = await readOptionalText(path.join(tempDirectory, "pooler-url"));
  const poolerRefs = poolerValue ? extractSupabaseProjectRefs(poolerValue) : [];
  const projectRefMatches = projectRef === expectedRef;
  const poolerRefMatches = poolerRefs.length === 1 && poolerRefs[0] === expectedRef;

  return {
    expectedRef,
    projectRef: projectRef ?? "MISSING",
    poolerRefs,
    projectRefMatches,
    poolerRefMatches,
    passed: projectRefMatches && poolerRefMatches,
  };
}

function readFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const expectedRef = readFlag("--expected-ref") ?? process.env.FVI_EXPECTED_SUPABASE_REF;
  if (!expectedRef) {
    throw new Error(
      "Set FVI_EXPECTED_SUPABASE_REF or pass --expected-ref before checking link state",
    );
  }

  const state = await inspectSupabaseLinkState({ expectedRef });
  console.log(`expected_project_ref=${state.expectedRef}`);
  console.log(`cached_project_ref=${state.projectRef}`);
  console.log(
    `cached_pooler_refs=${state.poolerRefs.length > 0 ? state.poolerRefs.join(",") : "MISSING"}`,
  );
  console.log(`${state.projectRefMatches ? "PASS" : "FAIL"} cached_project_ref_matches`);
  console.log(`${state.poolerRefMatches ? "PASS" : "FAIL"} cached_pooler_ref_matches`);

  if (!state.passed) process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
