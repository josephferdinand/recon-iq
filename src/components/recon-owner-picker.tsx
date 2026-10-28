import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listBusinessUnits } from "@/lib/business-units.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";

export function ReconOwnerPicker({ tenantId, value, onChange, disabled = false }: {
  tenantId: string;
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const list = useServerFn(listBusinessUnits);
  const units = useQuery({
    queryKey: ["recon-owner-bu-choices", tenantId],
    queryFn: () => list({ data: { tenant_id: tenantId } }),
    retry: false,
  });
  const available = (units.data ?? []).filter((unit) => !unit.is_archived);
  return (
    <fieldset className="space-y-2 rounded-md border p-3" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">Owning business units</legend>
      <p className="text-xs text-muted-foreground">Select at least one owner. Access is checked against these units when the reconciliation is created.</p>
      {units.isPending ? <p className="text-xs text-muted-foreground">Loading business units…</p> : null}
      {units.isError ? <div role="alert" aria-live="assertive" className="space-y-2 text-xs text-destructive"><p>Business units could not be loaded. Creation is unavailable until the owner list can be confirmed.</p><Button type="button" size="sm" variant="outline" onClick={() => void units.refetch()}>Refresh business units</Button></div> : null}
      {units.isSuccess && available.length === 0 ? <p role="alert" className="text-xs text-destructive">No active business unit is available. Ask a tenant administrator to configure one before creating a reconciliation.</p> : null}
      {available.map((unit) => (
        <label key={unit.id} className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50">
          <Checkbox
            checked={value.includes(unit.id)}
            onCheckedChange={(checked) => onChange(checked === true
              ? [...new Set([...value, unit.id])]
              : value.filter((id) => id !== unit.id))}
          />
          <span>{unit.depth > 0 ? "↳ " : ""}{unit.name}{unit.code ? <span className="ml-2 text-xs text-muted-foreground">{unit.code}</span> : null}</span>
        </label>
      ))}
    </fieldset>
  );
}
