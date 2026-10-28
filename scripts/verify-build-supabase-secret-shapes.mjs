import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "dist");
async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(target)));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

const files = await filesUnder(root);
let secretKeyShapes = 0;
let serviceRoleJwts = 0;
for (const file of files) {
  const text = (await readFile(file)).toString("utf8");
  for (const match of text.matchAll(/sb_secret_[A-Za-z0-9._-]{20,}/gu)) {
    const suffix = match[0].slice("sb_secret_".length);
    // Documentation contains obvious placeholder examples such as repeated x.
    // A real modern secret is long and high-diversity, so fail only on that shape.
    if (suffix.length >= 30 && new Set(suffix).size >= 12) secretKeyShapes += 1;
  }
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gu)) {
    try {
      const payload = JSON.parse(Buffer.from(match[0].split(".")[1], "base64url").toString("utf8"));
      if (payload?.role === "service_role") serviceRoleJwts += 1;
    } catch { /* unrelated string */ }
  }
}
console.log(JSON.stringify({ ok: secretKeyShapes === 0 && serviceRoleJwts === 0, filesChecked: files.length, secretKeyShapes, serviceRoleJwts }));
if (secretKeyShapes !== 0 || serviceRoleJwts !== 0) process.exitCode = 1;
