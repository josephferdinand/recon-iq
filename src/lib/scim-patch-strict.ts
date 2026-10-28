// RFC 7644 §3.5.2 strict PATCH parser.
// Throws ScimPatchError with typed code on any structural problem.
// Pure, no IO. Pairs with src/lib/scim-patch-apply.ts for execution.

export type ScimPatchOp = "add" | "remove" | "replace";

export interface ScimPatchOperation {
  op: ScimPatchOp;
  path?: string;
  value?: unknown;
}

export interface ScimPatchBody {
  schemas: string[];
  Operations: ScimPatchOperation[];
}

export type ScimPatchErrorCode =
  | "invalid_body"
  | "invalid_op"
  | "missing_value"
  | "missing_path";

export class ScimPatchError extends Error {
  constructor(public code: ScimPatchErrorCode, message: string) {
    super(message);
    this.name = "ScimPatchError";
  }
}

const PATCH_SCHEMA_URI = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseScimPatch(body: unknown): ScimPatchBody {
  if (!isPlainObject(body)) {
    throw new ScimPatchError("invalid_body", "PATCH body must be a JSON object");
  }
  const schemas = body.schemas;
  if (!Array.isArray(schemas) || !schemas.map(String).includes(PATCH_SCHEMA_URI)) {
    throw new ScimPatchError(
      "invalid_body",
      `PATCH body must include schema URI "${PATCH_SCHEMA_URI}"`,
    );
  }
  const opsRaw = body.Operations;
  if (!Array.isArray(opsRaw)) {
    throw new ScimPatchError("invalid_body", "Operations must be an array");
  }
  if (opsRaw.length === 0) {
    throw new ScimPatchError("invalid_body", "Operations array must not be empty");
  }

  const operations: ScimPatchOperation[] = opsRaw.map((raw, idx) => {
    if (!isPlainObject(raw)) {
      throw new ScimPatchError("invalid_body", `Operations[${idx}] must be an object`);
    }
    const opVal = typeof raw.op === "string" ? raw.op.toLowerCase() : "";
    if (opVal !== "add" && opVal !== "remove" && opVal !== "replace") {
      throw new ScimPatchError(
        "invalid_op",
        `Operations[${idx}].op must be "add", "remove", or "replace" (got "${String(raw.op)}")`,
      );
    }
    const op = opVal as ScimPatchOp;

    const path =
      typeof raw.path === "string" && raw.path.trim().length > 0 ? raw.path.trim() : undefined;
    const hasValueKey = Object.prototype.hasOwnProperty.call(raw, "value");
    const value = hasValueKey ? raw.value : undefined;

    if (op === "remove") {
      if (!path) {
        throw new ScimPatchError(
          "missing_path",
          `Operations[${idx}]: "remove" requires "path" (RFC 7644 §3.5.2.2)`,
        );
      }
      if (hasValueKey && value !== null && value !== undefined) {
        // RFC 7644 allows value on remove for filtered multi-valued attrs, but
        // bare scalar/object payloads on a 'remove' are a strong client bug
        // signal. Be lenient: accept but normalize to undefined.
        return { op, path };
      }
      return { op, path };
    }

    // add / replace
    if (!hasValueKey || value === undefined) {
      throw new ScimPatchError(
        "missing_value",
        `Operations[${idx}]: "${op}" requires "value"`,
      );
    }
    return path ? { op, path, value } : { op, value };
  });

  return { schemas: schemas.map(String), Operations: operations };
}
