import { createFileRoute, getRouteApi, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAidpDocument, listAidpDocumentTypes, setAidpDocumentMeta } from "@/lib/aidp.functions";
import { PdfAnnotator } from "@/components/aidp/pdf-annotator";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, FileScan } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const parentRoute = getRouteApi("/_authenticated/$slug");

export const Route = createFileRoute("/_authenticated/$slug/aidp/annotate/$documentId")({
  component: AnnotatePage,
  errorComponent: ({ error, reset }) => (
    <div className="p-6">
      <p className="text-sm text-destructive">Failed to load document: {error instanceof Error ? error.message : "An unexpected error occurred."}</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={reset}>Retry</Button>
    </div>
  ),
  notFoundComponent: () => <div className="p-6 text-sm text-muted-foreground">Document not found.</div>,
});

function AnnotatePage() {
  const router = useRouter();
  const { tenant } = parentRoute.useLoaderData();
  const { documentId } = Route.useParams();

  const getDoc = useServerFn(getAidpDocument);
  const listDt = useServerFn(listAidpDocumentTypes);
  const setMeta = useServerFn(setAidpDocumentMeta);

  const docQ = useQuery({
    queryKey: ["aidp-doc", tenant.id, documentId],
    queryFn: () => getDoc({ data: { tenant_id: tenant.id, document_id: documentId } }),
  });
  const dtQ = useQuery({
    queryKey: ["aidp-doctypes", tenant.id],
    queryFn: () => listDt({ data: { tenant_id: tenant.id } }),
  });

  const [savingDt, setSavingDt] = useState(false);

  const doc = docQ.data;
  const docTypeId = doc?.document_type_id ?? null;
  const sourcePath = `${tenant.id}/${documentId}/source.pdf`;

  async function chooseDocType(id: string) {
    setSavingDt(true);
    try {
      await setMeta({
        data: { tenant_id: tenant.id, document_id: documentId, document_type_id: id },
      });
      await docQ.refetch();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingDt(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => router.history.back()}>
            <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
          </Button>
          <div className="flex items-center gap-2">
            <FileScan className="h-4 w-4 text-muted-foreground" />
            <h1 className="text-lg font-semibold">{doc?.original_filename ?? "Document"}</h1>
            {doc ? <Badge variant="outline" className="text-[10px]">{doc.status}</Badge> : null}
          </div>
        </div>
        <Link
          to="/$slug/workspace"
          params={{ slug: tenant.slug }}
          search={{ page: "aidp" }}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Back to AIDP
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <div className="space-y-1">
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Document type
          </div>
          <Select
            value={docTypeId ?? ""}
            onValueChange={chooseDocType}
            disabled={savingDt || !dtQ.data?.length}
          >
            <SelectTrigger className="w-72">
              <SelectValue placeholder={dtQ.data?.length ? "Select a document type" : "No document types yet"} />
            </SelectTrigger>
            <SelectContent>
              {(dtQ.data ?? []).map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="ml-auto max-w-md text-[11px] text-muted-foreground">
          Choose the document type to load its entity schema. Drag to draw bounding boxes for each
          field; annotations train the prediction loop in Slice 3.
        </p>
      </div>

      <PdfAnnotator
        tenantId={tenant.id}
        documentId={documentId}
        documentTypeId={docTypeId}
        sourcePdfPath={sourcePath}
      />
    </div>
  );
}
