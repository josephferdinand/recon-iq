import { describe, expect, it } from "vitest";
import { predictionAttemptIdempotencyKey } from "../src/lib/aidp-api-job-worker.server";
import { readAidpPageDimensions } from "../src/lib/aidp-predict-internal.server";

describe("AIDP retry prediction identity", () => {
  it("creates a stable key for one attempt and a distinct key for the next", () => {
    expect(predictionAttemptIdempotencyKey("job-1", 1)).toBe("aidp-job:job-1:attempt:1");
    expect(predictionAttemptIdempotencyKey("job-1", 2)).toBe("aidp-job:job-1:attempt:2");
    expect(predictionAttemptIdempotencyKey("job-1", 1)).not.toBe(
      predictionAttemptIdempotencyKey("job-1", 2),
    );
  });
});

describe("AIDP lazy page registration", () => {
  it("reads mandatory PNG dimensions from the IHDR header", () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
    new DataView(png.buffer).setUint32(16, 1400);
    new DataView(png.buffer).setUint32(20, 900);
    expect(readAidpPageDimensions(png, "image/png")).toEqual({ width: 1400, height: 900 });
  });

  it("derives 150 DPI registration geometry from a PDF MediaBox", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 595.276 841.89] >>");
    expect(readAidpPageDimensions(pdf, "application/pdf")).toEqual({ width: 1240, height: 1754 });
  });
});
