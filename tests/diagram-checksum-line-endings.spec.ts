import { describe, expect, it } from "vitest";

import { normalizeDiagramSource, sha256DiagramOutput, sha256DiagramSource } from "../scripts/diagrams-checksum.mjs";

describe("diagram source checksum portability", () => {
  it("hashes LF, CRLF, and legacy CR source identically", () => {
    const lf = Buffer.from("flowchart TD\n  A --> B\n");
    const crlf = Buffer.from("flowchart TD\r\n  A --> B\r\n");
    const cr = Buffer.from("flowchart TD\r  A --> B\r");
    expect(sha256DiagramSource(crlf)).toBe(sha256DiagramSource(lf));
    expect(sha256DiagramSource(cr)).toBe(sha256DiagramSource(lf));
    expect(normalizeDiagramSource(crlf).toString("utf8")).toBe(lf.toString("utf8"));
    expect(sha256DiagramOutput(crlf, "svg")).toBe(sha256DiagramOutput(lf, "svg"));
    expect(sha256DiagramOutput(crlf, "png")).not.toBe(sha256DiagramOutput(lf, "png"));
  });
});
