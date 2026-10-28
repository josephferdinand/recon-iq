// Diagram gallery registry.
// Bundles every rendered SVG under docs/diagrams/rendered/ as a URL so the
// docs hub can display thumbnails and open full-size views. Sources under
// docs/diagrams/*.mmd are bundled as raw text for inline "view source".

const svgUrls = import.meta.glob("/docs/diagrams/rendered/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const pngUrls = import.meta.glob("/docs/diagrams/rendered/*.png", {
  query: "?url",
  import: "default",
  eager: true,
}) as Record<string, string>;

const mmdSources = import.meta.glob("/docs/diagrams/*.mmd", {
  query: "?raw",
  import: "default",
}) as Record<string, () => Promise<string>>;

export type DiagramEntry = {
  id: string;
  title: string;
  svgUrl: string;
  pngUrl?: string;
  sourcePath: string;
};

function idFromPath(p: string): string {
  return p.split("/").pop()!.replace(/\.(svg|png|mmd)$/, "");
}

function humanTitle(id: string): string {
  // "01_system_context" → "01 · System Context"
  const [num, ...rest] = id.split("_");
  const label = rest.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
  return /^\d+$/.test(num) ? `${num} · ${label}` : id.replace(/_/g, " ");
}

export const DIAGRAMS: DiagramEntry[] = Object.keys(svgUrls)
  .sort()
  .map((path) => {
    const id = idFromPath(path);
    const pngPath = `/docs/diagrams/rendered/${id}.png`;
    return {
      id,
      title: humanTitle(id),
      svgUrl: svgUrls[path],
      pngUrl: pngUrls[pngPath],
      sourcePath: `/docs/diagrams/${id}.mmd`,
    };
  });

export async function loadDiagramSource(id: string): Promise<string | null> {
  const loader = mmdSources[`/docs/diagrams/${id}.mmd`];
  if (!loader) return null;
  try {
    return await loader();
  } catch {
    return null;
  }
}

export function findDiagram(id: string): DiagramEntry | undefined {
  return DIAGRAMS.find((d) => d.id === id);
}
