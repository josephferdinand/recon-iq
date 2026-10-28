import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getResourceAccessSummaries, type ResourceAccessType } from "@/lib/resource-access-summaries.functions";
import { currentResourceMappingDisplay, resourceMappingDisplayKey } from "@/lib/resource-mapping-display";

/** Ordinary authenticated metadata read; independent of page/write/admin permission gates. */
export function useResourceMappingDisplay({ tenantId, resourceType, resourceIds }: {
  tenantId: string; resourceType: ResourceAccessType; resourceIds: string[];
}) {
  const getSummary = useServerFn(getResourceAccessSummaries);
  const [actorId, setActorId] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let changed = false;
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      changed = true;
      if (active) setActorId(session?.user.id ?? null);
    });
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && !changed) setActorId(error ? null : data.session?.user.id ?? null);
    }).catch(() => { if (active && !changed) setActorId(null); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  const ids = [...new Set(resourceIds)].sort();
  const query = useQuery({
    queryKey: resourceMappingDisplayKey(tenantId, actorId, resourceType, ids),
    queryFn: () => getSummary({ data: { resource_type: resourceType, resource_ids: ids } }),
    enabled: Boolean(tenantId && actorId && ids.length > 0 && ids.length <= 100),
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    placeholderData: undefined,
  });
  const data = currentResourceMappingDisplay(resourceType, ids, { actorId, isSuccess: query.isSuccess, isFetching: query.isFetching, data: query.data });
  return { data, refetch: query.refetch };
}
