import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const [artifactRootValue = "dist", environmentFileValue = ".env.local"] = process.argv.slice(2);
const artifactRoot = path.resolve(artifactRootValue);
const environmentFile = path.resolve(environmentFileValue);

const environmentText = await readFile(environmentFile, "utf8");
const serviceRoleLine = environmentText
  .split(/\r?\n/u)
  .find((line) => line.startsWith("SUPABASE_SERVICE_ROLE_KEY="));

if (!serviceRoleLine) {
  throw new Error("Protected environment file has no SUPABASE_SERVICE_ROLE_KEY entry");
}

const serviceRoleKey = serviceRoleLine.slice(serviceRoleLine.indexOf("=") + 1).trim();
if (serviceRoleKey.length < 30) {
  throw new Error("Protected service-role value does not have a valid credential shape");
}

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

const artifactFiles = await filesUnder(artifactRoot);
let matches = 0;
for (const file of artifactFiles) {
  const bytes = await readFile(file);
  if (bytes.includes(Buffer.from(serviceRoleKey))) matches += 1;
}

console.log(
  JSON.stringify({
    ok: matches === 0,
    artifactRoot,
    filesChecked: artifactFiles.length,
    serviceRoleMatches: matches,
  }),
);

if (matches !== 0) process.exitCode = 1;
