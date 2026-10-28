import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProcessLibrary } from "@/lib/process-library.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Library, Download, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

export function ProcessLibraryTab() {
  const list = useServerFn(listProcessLibrary);
  const q = useQuery({ queryKey: ["process-library"], queryFn: () => list({ data: {} }) });

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>("all");

  const entries = q.data ?? [];
  const categories = useMemo(() => {
    const set = new Set<string>();
    entries.forEach((p: any) => p.category && set.add(p.category));
    return Array.from(set).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return entries.filter((p: any) => {
      if (category !== "all" && p.category !== category) return false;
      if (!term) return true;
      return (
        p.title?.toLowerCase().includes(term) ||
        p.summary?.toLowerCase().includes(term) ||
        p.asset_class?.toLowerCase?.().includes(term) ||
        p.slug?.toLowerCase().includes(term)
      );
    });
  }, [entries, category, query]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Library className="h-4 w-4" /> Process Library
              <Badge variant="secondary" className="text-[10px]">{entries.length} accelerators</Badge>
            </CardTitle>
            <CardDescription>
              Production-grade reconciliation blueprints — Nostro, Custody, Card Scheme, Crypto, Insurance, Regulatory and more.
              Clone any blueprint into ReconIQ Studio with one click.
            </CardDescription>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, asset class, or keyword…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-56"><SelectValue placeholder="All categories" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories ({entries.length})</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c} ({entries.filter((p: any) => p.category === c).length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!q.isLoading && filtered.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
            <Sparkles className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No accelerators match your filters. Try clearing the search or selecting a different category.
            </p>
          </div>
        )}
        <div className="grid gap-2 md:grid-cols-2">
          {filtered.map((p: any) => (
            <div key={p.id} className="flex items-start justify-between gap-3 rounded-md border p-3 hover:border-primary/40 hover:bg-muted/30 transition-colors">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{p.title}</span>
                  <Badge variant="secondary" className="text-[10px]">v{p.version}</Badge>
                  <Badge variant="outline" className="text-[10px]">{p.category}</Badge>
                  {p.asset_class && <Badge variant="outline" className="text-[10px]">{p.asset_class}</Badge>}
                </div>
                <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{p.summary}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => toast.info(`Cloning '${p.title}' into ReconIQ Studio…`)}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Clone
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
