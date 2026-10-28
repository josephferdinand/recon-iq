import { describe,it,expect } from "vitest";
import { statusUtcInput,statusUtcValue } from "@/lib/status-date-utils";
describe("status historical timestamps",()=>{
 it("preserves untouched original fractional precision and offsets",()=>{const original="2025-01-01T09:05:04.123456+05:30";expect(statusUtcValue(statusUtcInput(original),original)).toBe(original);});
 it("records an explicit UTC edit without inventing a local offset",()=>{expect(statusUtcValue("2025-01-01T01:02:03.456")).toBe("2025-01-01T01:02:03.456Z");expect(statusUtcValue("")).toBeNull();});
});
