import {describe,it,expect} from "vitest";import {renderToStaticMarkup} from "react-dom/server";
import {StatusPublicView} from "@/components/status-public-view";import {statusPrototypeSnapshot} from "@/lib/status-prototype-data";
describe("FVI refinement readable design contract",()=>{
 it("compares actual scopes, labels declarations and retains every original component",()=>{
  const snapshot=statusPrototypeSnapshot();const text=renderToStaticMarkup(<StatusPublicView snapshot={snapshot} preview/>);
  for(const label of ["Reconciliation","Data Prep","Copilot","Schedules &amp; recovery","Production","Development","Region unverified","Deployment unverified","Declared component catalog (8)"])expect(text.includes(label)).toBe(true);
  expect(text.includes("Unknown service health")).toBe(true);expect(text.includes("All systems operational")).toBe(false);
 });
 it("requires explicit confirmation-consent wording and does not promise delivery",()=>{
  const text=renderToStaticMarkup(<StatusPublicView snapshot={statusPrototypeSnapshot()} preview subscribe={async()=>{}}/>);
  expect(text.includes('type="checkbox"')).toBe(true);expect(text.includes("Email confirmation is required")).toBe(true);expect(text.includes("Confirmation delivery awaiting verification")).toBe(true);
  expect(text.includes("Check your inbox")).toBe(false);
 });
});
