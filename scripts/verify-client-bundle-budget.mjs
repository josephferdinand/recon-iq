import { readdir, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import path from "node:path";

const limits = Object.freeze({
  chunkCount: 820,
  totalGzipBytes: 3_800_000,
  largestRawBytes: 625_000,
  largestGzipBytes: 190_000,
});

const assetsDir = path.resolve(process.cwd(), "dist", "assets");

let names;
try {
  names = await readdir(assetsDir);
} catch (error) {
  console.error(`bundle-budget FAIL: cannot read ${assetsDir}`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const chunks = await Promise.all(
  names
    .filter((name) => name.endsWith(".js"))
    .map(async (name) => {
      const content = await readFile(path.join(assetsDir, name));
      return {
        name,
        rawBytes: content.byteLength,
        gzipBytes: gzipSync(content).byteLength,
      };
    }),
);

if (chunks.length === 0) {
  console.error(`bundle-budget FAIL: no client JavaScript chunks found in ${assetsDir}`);
  process.exit(1);
}

chunks.sort((left, right) => right.rawBytes - left.rawBytes);
const largest = chunks[0];
const totalGzipBytes = chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0);
const failures = [];

if (chunks.length > limits.chunkCount) {
  failures.push(`chunk count ${chunks.length} exceeds ${limits.chunkCount}`);
}
if (totalGzipBytes > limits.totalGzipBytes) {
  failures.push(`total gzip ${totalGzipBytes} exceeds ${limits.totalGzipBytes}`);
}
if (largest.rawBytes > limits.largestRawBytes) {
  failures.push(
    `largest raw chunk ${largest.name} (${largest.rawBytes}) exceeds ${limits.largestRawBytes}`,
  );
}
if (largest.gzipBytes > limits.largestGzipBytes) {
  failures.push(
    `largest gzip chunk ${largest.name} (${largest.gzipBytes}) exceeds ${limits.largestGzipBytes}`,
  );
}

const summary = {
  chunkCount: chunks.length,
  totalGzipBytes,
  largest,
  limits,
};

if (failures.length > 0) {
  console.error(`bundle-budget FAIL: ${failures.join("; ")}`);
  console.error(JSON.stringify(summary, null, 2));
  process.exit(1);
}

console.log(`bundle-budget PASS ${JSON.stringify(summary)}`);
