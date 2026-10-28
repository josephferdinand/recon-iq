import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("AIDP central screen contract", () => {
  it("uses tenant-scoped server pagination, search and filters for both resource lists", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/lib/aidp.functions.ts", import.meta.url)), "utf8");
    const templates = source.match(/export const listAidpTemplates[\s\S]*?\/\* ---------------- Documents/u)?.[0] ?? "";
    const documents = source.match(/export const listAidpDocuments[\s\S]*?export const createAidpDocument/u)?.[0] ?? "";
    for (const block of [templates, documents]) {
      expect(block).toContain('.eq("tenant_id", data.tenant_id)');
      expect(block).toContain('.ilike(');
      expect(block).toContain('count: "exact"');
      expect(block).toContain(".range(from, from + data.page_size - 1)");
      expect(block).toContain('if (error || !Array.isArray(rows) || typeof count !== "number") throw');
    }
  });

  it("preserves annotation and audit actions without advertising image OCR or invented limits", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/components/aidp-tab.tsx", import.meta.url)), "utf8");
    expect(source).toContain("Review");
    expect(source).toContain("Audit");
    expect(source).toContain("Approve");
    expect(source).toContain("scanned-image OCR is unavailable");
    expect(source).toContain("Unsupported content may not produce an extractable preview.");
    expect(source).not.toContain("100 MB");
    expect(source).not.toContain("PNG, JPG");
  });

  it("distinguishes unavailable data from a true empty result", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/components/aidp-tab.tsx", import.meta.url)), "utf8");
    expect(source).toContain("Templates unavailable");
    expect(source).toContain("Documents unavailable");
    expect(source).toContain("No templates found");
    expect(source).toContain("No documents found");
    expect(source).toContain("tQ.refetch()");
    expect(source).toContain("dQ.refetch()");
  });

  it("requires an accessible selected-file state before upload while keeping templates optional", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/components/aidp-tab.tsx", import.meta.url)), "utf8");
    expect(source).toContain("const [selectedFile, setSelectedFile] = useState<File | null>(null)");
    expect(source).toContain("mUpload.isPending || !selectedFile");
    expect(source).toContain("if (f) setSelectedFile(f)");
    expect(source).toContain("Select a document file to enable upload");
    expect(source).toContain('aria-describedby="aidp-upload-guidance"');
    expect(source).toContain('role="status"');
    expect(source).toContain("(optional)");
    expect(source).toContain("Choosing a template is optional");
    expect(source).not.toMatch(/onChange=\{\(e\) => \{\s*const f = e\.target\.files\?\.\[0\]; if \(f\) mUpload\.mutate/u);
  });

  it("makes every tenant template reachable in the upload picker and keeps the selected label stable", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/components/aidp-tab.tsx", import.meta.url)), "utf8");
    expect(source).toContain('queryKey: ["aidp-tpl-options", tenantId, tplOptionPage, tplOptionSearch]');
    expect(source).toContain('page: tplOptionPage, page_size: PAGE_SIZE, search: tplOptionSearch');
    expect(source).toContain('aria-label="Search available templates"');
    expect(source).toContain("setTplOptionPage((p) => p + 1)");
    expect(source).toContain("Showing ${tplOptionPage * PAGE_SIZE + 1}");
    expect(source).toContain("No matching templates. Refine the search or choose No template.");
    expect(source).toContain("tplPickLabel");
    expect(source).not.toContain("page_size: 100, search: \"\"");
    expect(source).toContain('<SelectItem value="none">No template</SelectItem>');
  });

  it("matches the upload-first Document Desk hierarchy and keeps real document actions", async () => {
    const source = await readFile(fileURLToPath(new URL("../src/components/aidp-tab.tsx", import.meta.url)), "utf8");
    expect(source).toContain("Document processing");
    expect(source).toContain("Extraction options");
    expect(source).toContain("Recent documents");
    expect(source).toContain('href="#aidp-templates"');
    expect(source).toContain('id="aidp-templates"');
    expect(source).toContain("Document name");
    expect(source).toContain("Uploaded");
    expect(source).toContain("Status");
    expect(source).toContain("Manage templates");
    expect(source).toContain("template_id");
    expect(source).not.toContain("Document workflow");
    expect(source).toContain("scanned-image OCR is unavailable");
    expect(source).not.toContain("100 MB");
    expect(source).not.toContain("PNG, JPG");
  });
});
