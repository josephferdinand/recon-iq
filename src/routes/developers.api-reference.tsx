import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/developers/api-reference")({
  head: () => ({
    meta: [
      { title: "API Reference — ReconIQ Developer Portal" },
      {
        name: "description",
        content:
          "Complete OpenAPI 3.1 reference for the ReconIQ API, rendered with Redoc. Endpoints, schemas, request/response examples, error model.",
      },
    ],
  }),
  component: ApiReference,
});

// Redoc renders client-side from the OpenAPI YAML endpoint.
function ApiReference() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    const REDOC_SRC = "https://cdn.jsdelivr.net/npm/redoc@2.5.0/bundles/redoc.standalone.js";

    const init = () => {
      const w = window as unknown as {
        Redoc?: {
          init: (
            spec: string,
            opts: unknown,
            el: HTMLElement,
            cb?: (err?: unknown) => void,
          ) => void;
        };
      };
      if (!w.Redoc || !containerRef.current) {
        setStatus("error");
        return;
      }
      w.Redoc.init(
        "/api/public/openapi.yaml",
        {
          scrollYOffset: 56,
          hideDownloadButton: false,
          expandResponses: "200,201",
          jsonSampleExpandLevel: 2,
          nativeScrollbars: true,
          theme: {
            colors: {
              primary: { main: "#7A4A0F" },
              success: { main: "#166534" },
              error: { main: "#8B1E1E" },
            },
            typography: {
              fontFamily:
                'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif',
              headings: {
                fontFamily:
                  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif',
              },
              code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
            },
          },
        },
        containerRef.current,
        (err) => setStatus(err ? "error" : "ready"),
      );
    };

    const existing = document.querySelector<HTMLScriptElement>('script[data-fvi-redoc="1"]');
    if (existing) {
      init();
      return;
    }
    const s = document.createElement("script");
    s.src = REDOC_SRC;
    s.async = true;
    s.dataset.fviRedoc = "1";
    s.onload = init;
    s.onerror = () => setStatus("error");
    document.head.appendChild(s);
  }, []);

  return (
    <main className="mx-auto max-w-full">
      {status === "loading" && (
        <div className="px-6 py-10 text-sm text-muted-foreground">Loading API reference…</div>
      )}
      {status === "error" && (
        <div className="px-6 py-10 text-sm text-destructive">
          Failed to load the interactive reference. You can still download the raw spec:{" "}
          <a className="underline" href="/api/public/openapi.yaml">
            /api/public/openapi.yaml
          </a>
          .
        </div>
      )}
      <style>{`
        #fvi-redoc a { color: #7A4A0F !important; }
        #fvi-redoc code { color: #8B1E1E !important; }
        #fvi-redoc .redoc-json .token.punctuation { color: #F3DAC2 !important; }
        #fvi-redoc h5, #fvi-redoc caption, #fvi-redoc table span { color: #4B5563 !important; }
        #fvi-redoc button:has(> strong), #fvi-redoc button:has(> strong) * { color: #1F2937 !important; }
        #fvi-redoc .tab-error[aria-selected="true"] { color: #8B1E1E !important; }
        #fvi-redoc .tab-error[aria-selected="false"] { color: #FF8A80 !important; }
      `}</style>
      <div id="fvi-redoc" ref={containerRef} data-redoc-status={status} />
    </main>
  );
}
