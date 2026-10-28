import test from "node:test";
import assert from "node:assert/strict";
import { toCrossJSONAsync } from "seroval";
import { defaultSerovalPlugins } from "@tanstack/router-core";
import { decodeSavedResponse } from "./saved-response-decoder.mjs";
test("installed TanStack plugins retain the Error prototype in a synthetic saved frame", async () => {
  const frame = await toCrossJSONAsync({ error: new Error("SYNTHETIC QA refusal") }, { plugins: defaultSerovalPlugins });
  const decoded = decodeSavedResponse(frame, true);
  assert.ok(decoded.error instanceof Error);
  assert.equal(decoded.error.message, "SYNTHETIC QA refusal");
});
test("ordinary saved REST JSON does not enter the Seroval decoder", () => {
  const payload = { code: "SYNTHETIC_REFUSAL", message: "Synthetic fixture only" };
  assert.equal(decodeSavedResponse(payload, false), payload);
});
