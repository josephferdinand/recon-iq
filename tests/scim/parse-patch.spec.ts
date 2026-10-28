import { describe, it, expect } from "vitest";
import { parseScimPatch, ScimPatchError } from "@/lib/scim-patch-strict";

const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function body(operations: unknown[]) {
  return { schemas: [PATCH_SCHEMA], Operations: operations };
}

describe("parseScimPatch", () => {
  it("accepts a valid add op", () => {
    const out = parseScimPatch(body([{ op: "add", path: "department", value: "Finance" }]));
    expect(out.Operations).toEqual([{ op: "add", path: "department", value: "Finance" }]);
  });

  it("accepts a valid remove op", () => {
    const out = parseScimPatch(body([{ op: "remove", path: "active" }]));
    expect(out.Operations[0]).toEqual({ op: "remove", path: "active" });
  });

  it("accepts a valid replace op", () => {
    const out = parseScimPatch(body([{ op: "replace", path: "displayName", value: "Jane Doe" }]));
    expect(out.Operations[0]).toEqual({ op: "replace", path: "displayName", value: "Jane Doe" });
  });

  it("accepts a replace with filter path (emails[primary eq true].value)", () => {
    const out = parseScimPatch(
      body([{ op: "replace", path: 'emails[primary eq true].value', value: "j@x.com" }]),
    );
    expect(out.Operations[0].path).toBe('emails[primary eq true].value');
  });

  it("invalid op string throws invalid_op", () => {
    expect(() => parseScimPatch(body([{ op: "InvalidOp", path: "x", value: 1 }]))).toThrowError(
      expect.objectContaining({ code: "invalid_op" }) as unknown as Error,
    );
  });

  it("missing value for add throws missing_value", () => {
    try {
      parseScimPatch(body([{ op: "add", path: "department" }]));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ScimPatchError);
      expect((e as ScimPatchError).code).toBe("missing_value");
    }
  });

  it("missing path for remove throws missing_path", () => {
    try {
      parseScimPatch(body([{ op: "remove" }]));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ScimPatchError).code).toBe("missing_path");
    }
  });

  it("empty Operations array throws invalid_body", () => {
    try {
      parseScimPatch(body([]));
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ScimPatchError).code).toBe("invalid_body");
    }
  });

  it("body not an object throws invalid_body", () => {
    try {
      parseScimPatch("not an object" as unknown);
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ScimPatchError).code).toBe("invalid_body");
    }
  });

  it("missing schema URI throws invalid_body", () => {
    try {
      parseScimPatch({ schemas: ["urn:other"], Operations: [{ op: "add", value: 1 }] });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as ScimPatchError).code).toBe("invalid_body");
    }
  });
});
