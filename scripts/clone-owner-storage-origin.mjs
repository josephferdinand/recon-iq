import { readFile, writeFile } from "node:fs/promises";

const [sourceFile, outputFile, targetOriginValue, explicitSourceOrigin] = process.argv.slice(2);
if (!sourceFile || !outputFile || !targetOriginValue) {
  throw new Error("Usage: clone-owner-storage-origin <source> <output> <target-origin>");
}

const targetOrigin = new URL(targetOriginValue).origin;
const targetHost = new URL(targetOrigin).hostname;
if (
    !targetHost.endsWith(".reconiq.example") &&
    !targetHost.endsWith(".fvi-app-staging.pages.dev") &&
    !targetHost.endsWith(".fvi-app.pages.dev")
) {
  throw new Error("Target must be an FVI DEV canonical or preview origin");
}

const source = JSON.parse(await readFile(sourceFile, "utf8"));
const sourceOrigin = explicitSourceOrigin
  ? new URL(explicitSourceOrigin).origin
  : targetHost.endsWith(".fvi-app.pages.dev")
    ? "https://app.reconiq.example"
    : "https://dev.app.reconiq.example";
const sourceHost = new URL(sourceOrigin).hostname;
if (
    !sourceHost.endsWith(".reconiq.example") &&
    !sourceHost.endsWith(".fvi-app-staging.pages.dev") &&
    !sourceHost.endsWith(".fvi-app.pages.dev")
) {
  throw new Error("Source must be an FVI canonical or preview origin");
}
const capturedOrigin = source.origins?.find(
  (entry) => entry.origin === sourceOrigin,
);
if (!capturedOrigin || !Array.isArray(capturedOrigin.localStorage)) {
  throw new Error(`Source storage state has no captured local storage for ${sourceOrigin}`);
}

await writeFile(
  outputFile,
  JSON.stringify(
    {
      cookies: [],
      origins: [{ origin: targetOrigin, localStorage: capturedOrigin.localStorage }],
    },
    null,
    2,
  ),
  { encoding: "utf8", mode: 0o600 },
);

console.log(
  JSON.stringify({
    ok: true,
    targetOrigin,
    localStorageEntries: capturedOrigin.localStorage.length,
    outputFile,
  }),
);
