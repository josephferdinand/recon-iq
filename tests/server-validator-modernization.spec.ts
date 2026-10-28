import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = join(process.cwd(), "src");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];

    return [path];
  });
}

describe("TanStack Start server validators", () => {
  it("does not use the deprecated inputValidator API", () => {
    const offenders = sourceFiles(sourceRoot)
      .filter((path) => readFileSync(path, "utf8").includes(".inputValidator("))
      .map((path) => relative(process.cwd(), path).replaceAll("\\", "/"));

    expect(offenders).toEqual([]);
  });
});
