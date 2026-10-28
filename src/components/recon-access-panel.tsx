import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, LockKeyhole, RefreshCw, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cutoverLegacyReconDefinition,
  getReconAccessSetup,
  grantReconBuAction,
  reconActionSchema,
  revokeReconBuAction,
  setReconOwners,
  type ReconAccessSetup,
  type ReconAction,
} from "@/lib/recon-access-setup.functions";
import {
  formatUserMessage,
  mapKnownFailure,
  type UserMessage,
  type UserMessageCategory,
} from "@/lib/user-message";

const ACTIONS = reconActionSchema.options;
const actionLabel: Record<ReconAction, string> = {
  view: "View",
  run: "Run",
  edit: "Edit",
  approve: "Approve",
};
const UUID_LABEL = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function accessWriteFailure(error: unknown, action: string): UserMessage {
  const candidate =
    error && typeof error === "object" ? (error as { code?: unknown; status?: unknown }) : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const status = typeof candidate.status === "number" ? candidate.status : undefined;
  const mapped = mapKnownFailure(code, status);
  const definitelyRejected = ["input", "business", "auth", "session", "mfa"].includes(
    mapped.category,
  );
  const category: UserMessageCategory = definitelyRejected
    ? mapped.category
    : "unknown_write_outcome";
  return formatUserMessage({
    ...mapped,
    category,
    action,
    code,
    status,
    availableActions:
      category === "unknown_write_outcome"
        ? [{ id: "read-access-state", label: "Refresh access setup" }]
        : [],
  });
}

function principalDisplayLabel(principal: { principal_id: string; label: string } | undefined) {
  if (!principal) return "Principal name unavailable";
  const label = principal.label.trim();
  if (!label || label === principal.principal_id || UUID_LABEL.test(label))
    return "Principal name unavailable";
  return label;
}

function businessUnitDisplayName(name: string | undefined) {
  return name?.trim() || "Business unit unavailable";
}

export function ReconAccessPanel({ reconId }: { reconId: string }) {
  const queryClient = useQueryClient();
  const setupFn = useServerFn(getReconAccessSetup);
  const setOwnersFn = useServerFn(setReconOwners);
  const grantFn = useServerFn(grantReconBuAction);
  const revokeFn = useServerFn(revokeReconBuAction);
  const cutoverFn = useServerFn(cutoverLegacyReconDefinition);
  const [reason, setReason] = useState("");
  const [selectedBuIds, setSelectedBuIds] = useState<string[] | null>(null);
  const [grantBuId, setGrantBuId] = useState("");
  const [principalKey, setPrincipalKey] = useState("");
  const [action, setAction] = useState<ReconAction>("view");
  const [selectedGrantKey, setSelectedGrantKey] = useState("");
  const [makerUserId, setMakerUserId] = useState("");
  const [checkerUserId, setCheckerUserId] = useState("");
  const [accessMessages, setAccessMessages] = useState<Readonly<Record<string, UserMessage>>>({});

  const setupQuery = useQuery({
    queryKey: ["recon-access-setup", reconId],
    queryFn: () => setupFn({ data: { recon_id: reconId } }),
    retry: false,
  });
  const setup = setupQuery.data as ReconAccessSetup | undefined;
  const buName = useMemo(
    () => new Map((setup?.available_business_units ?? []).map((bu) => [bu.bu_id, bu.name])),
    [setup],
  );
  const grantRows = useMemo(() => {
    const rows = new Map<string, ReconAccessSetup["grants"]>();
    for (const grant of setup?.grants ?? []) {
      const key = `${grant.bu_id}:${grant.principal_type}:${grant.principal_id}`;
      rows.set(key, [...(rows.get(key) ?? []), grant]);
    }
    return [...rows.values()];
  }, [setup]);
  const ownerIds = setup?.owners.map((owner) => owner.bu_id) ?? [];
  const principalParts = principalKey.split(":");
  const principalType = principalParts[0] === "group" ? "group" : "user";
  const principalId = principalParts[1] ?? "";
  // Include all active same-tenant choices. BU assignment inheritance is
  // checked by the cutover RPC and cannot be inferred from this summary.
  const availablePrincipals = (setup?.available_principals ?? []).filter(
    (p) => p.principal_type === principalType,
  );
  const availableUsers = (setup?.available_principals ?? []).filter(
    (p) => p.principal_type === "user",
  );
  const selectedPrincipalGrants = (setup?.grants ?? []).filter(
    (grant) => `${grant.principal_type}:${grant.principal_id}` === selectedGrantKey,
  );
  const selectedPrincipal = setup?.available_principals.find(
    (p) => `${p.principal_type}:${p.principal_id}` === selectedGrantKey,
  );

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["recon-access-setup", reconId] });
  function setAccessMessage(key: string, message: UserMessage | null) {
    setAccessMessages((current) => {
      const next = { ...current };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });
  }
  function accessMessageView(key: string) {
    const message = accessMessages[key];
    if (!message) return null;
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
      >
        <p className="font-medium">{message.title}</p>
        <p className="mt-1">{message.humanMessage}</p>
        {message.nextActions.map((action) => (
          <Button
            key={action.id}
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              if (action.id === "read-access-state") void setupQuery.refetch();
            }}
          >
            {action.label}
          </Button>
        ))}
      </div>
    );
  }

  function reasonError(key: string, field: string) {
    const message = accessMessages[key];
    return message?.fieldErrors[field] ?? message?.fieldErrors["Reason (at least 3 characters)"];
  }
  function requireReason(key: string, action: string, submit: () => void) {
    const length = reason.trim().length;
    if (length < 3 || length > 500) {
      const issue = length > 500 ? "too_long" : length ? "invalid_format" : "required";
      setAccessMessage(
        key,
        formatUserMessage({
          category: "input",
          action,
          fields: [
            {
              field: length > 0 && length < 3 ? "Reason (at least 3 characters)" : "Reason",
              issue,
              limit: issue === "too_long" ? 500 : undefined,
            },
          ],
        }),
      );
      return;
    }
    setAccessMessage(key, null);
    submit();
  }
  const ownerMutation = useMutation({
    mutationFn: () =>
      setOwnersFn({
        data: { recon_id: reconId, bu_ids: selectedBuIds ?? ownerIds, reason: reason.trim() },
      }),
    onSuccess: () => {
      setAccessMessage("owner", null);
      setReason("");
      setSelectedBuIds(null);
      invalidate();
    },
    onError: (error) =>
      setAccessMessage("owner", accessWriteFailure(error, "save these reconciliation owners")),
  });
  const grantMutation = useMutation({
    mutationFn: () =>
      grantFn({
        data: {
          recon_id: reconId,
          bu_id: grantBuId,
          principal_type: principalType,
          principal_id: principalId,
          action,
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      setAccessMessage("grant", null);
      setReason("");
      setPrincipalKey("");
      invalidate();
    },
    onError: (error) =>
      setAccessMessage("grant", accessWriteFailure(error, "grant this reconciliation action")),
  });
  const revokeMutation = useMutation({
    mutationFn: (grantId: string) =>
      revokeFn({ data: { grant_id: grantId, reason: reason.trim() } }),
    onSuccess: () => {
      setAccessMessage("revoke", null);
      setReason("");
      invalidate();
    },
    onError: (error) =>
      setAccessMessage("revoke", accessWriteFailure(error, "revoke this reconciliation action")),
  });
  const cutoverMutation = useMutation({
    mutationFn: () =>
      cutoverFn({
        data: {
          tenant_id: setup!.tenant_id,
          recon_id: reconId,
          owner_bu_ids: ownerIds,
          maker_user_id: makerUserId,
          checker_user_id: checkerUserId,
          reason: reason.trim(),
        },
      }),
    onSuccess: () => {
      setAccessMessage("cutover", null);
      invalidate();
    },
    onError: (error) =>
      setAccessMessage("cutover", accessWriteFailure(error, "record the legacy access cutover")),
  });

  if (setupQuery.isPending)
    return (
      <div role="status" className="p-4 text-sm text-muted-foreground">
        Loading reconciliation access…
      </div>
    );
  if (setupQuery.isError || !setup) {
    return (
      <Alert className="my-4">
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Access information temporarily unavailable</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>
            ReconIQ could not confirm the reconciliation’s owners or grants. No access changes are
            available until the check succeeds.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setupQuery.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry access check
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const canAdminister = setup.is_tenant_admin;
  const reasonReady = reason.trim().length >= 3;
  const ownerDraft = selectedBuIds ?? ownerIds;
  const ownersChanged =
    selectedBuIds !== null &&
    selectedBuIds.length > 0 &&
    (selectedBuIds.length !== ownerIds.length ||
      selectedBuIds.some((id) => !ownerIds.includes(id)));
  const principal = setup.available_principals.find(
    (p) => p.principal_id === principalId && p.principal_type === principalType,
  );
  const cutoverInputsReady =
    !setup.multi_bu_governed &&
    canAdminister &&
    ownerIds.length > 0 &&
    availableUsers.some((user) => user.principal_id === makerUserId) &&
    availableUsers.some((user) => user.principal_id === checkerUserId) &&
    makerUserId !== checkerUserId;

  return (
    <section aria-labelledby="recon-access-title" className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle id="recon-access-title" className="flex items-center gap-2">
                <LockKeyhole className="h-5 w-5 text-primary" />
                Reconciliation access
              </CardTitle>
              <CardDescription>
                Business unit ownership and exact group or user action grants for this
                reconciliation.
              </CardDescription>
            </div>
            <Badge variant={setup.multi_bu_governed ? "default" : "outline"}>
              {setup.multi_bu_governed
                ? "Multi-BU governance flag enabled"
                : "Governance flag off · owner mapping only"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <Alert>
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Authorization boundary</AlertTitle>
            <AlertDescription>
              {setup.multi_bu_governed
                ? "The multi-BU governance flag is enabled, but this access view does not prove runtime API or RLS enforcement."
                : "Owner mappings and grants are staged as shadow data. The cutover RPC rechecks eligibility and records the mapping transition; this panel does not prove enforcement across runtime APIs, workers, or RLS."}
            </AlertDescription>
          </Alert>

          <section aria-labelledby="owner-heading" className="space-y-3">
            <div>
              <h3 id="owner-heading" className="text-base font-semibold">
                Business unit ownership
              </h3>
              <p className="text-sm text-muted-foreground">
                Only owning business units can receive reconciliation grants.
              </p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Current owning business units">
              {setup.owners.length ? (
                setup.owners.map((owner) => (
                  <li key={owner.bu_id}>
                    <Badge variant="secondary">
                      {businessUnitDisplayName(buName.get(owner.bu_id))}
                    </Badge>
                  </li>
                ))
              ) : (
                <li className="text-sm text-muted-foreground">
                  No owning business units are recorded.
                </li>
              )}
            </ul>
            {canAdminister && (
              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Set owning business units</legend>
                {setup.available_business_units.length ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {setup.available_business_units.map((bu) => {
                      const checked = ownerDraft.includes(bu.bu_id);
                      return (
                        <label
                          key={bu.bu_id}
                          className="flex min-h-10 items-center gap-2 rounded px-2 hover:bg-muted/50"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            checked={checked}
                            onChange={(event) => {
                              const next = ownerDraft;
                              setSelectedBuIds(
                                event.target.checked
                                  ? [...next, bu.bu_id]
                                  : next.filter((id) => id !== bu.bu_id),
                              );
                            }}
                          />
                          <span className="text-sm">
                            {businessUnitDisplayName(bu.name)}
                            {bu.code ? (
                              <span className="ml-1 text-muted-foreground">({bu.code})</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No assignable business units were returned.
                  </p>
                )}
                <ReasonField
                  value={reason}
                  error={reasonError("owner", "Reason")}
                  onChange={(value) => {
                    setReason(value);
                    setAccessMessage("owner", null);
                  }}
                  id="owner-change-reason"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !ownersChanged ||
                    ownerMutation.isPending ||
                    !setup.available_business_units.length
                  }
                  onClick={() =>
                    requireReason("owner", "save these reconciliation owners", () =>
                      ownerMutation.mutate(),
                    )
                  }
                >
                  {ownerMutation.isPending ? "Saving…" : "Save ownership"}
                </Button>
                {accessMessageView("owner")}
              </fieldset>
            )}
          </section>

          <section aria-labelledby="grants-heading" className="space-y-3">
            <div>
              <h3 id="grants-heading" className="text-base font-semibold">
                Group and user access
              </h3>
              <p className="text-sm text-muted-foreground">
                Each row shows persisted grants for one principal and owning business unit. Your
                effective access is shown separately.
              </p>
            </div>
            {canAdminister && (
              <div className="grid gap-3 rounded-md border p-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="grant-bu">Business unit</Label>
                  <Select
                    value={grantBuId}
                    onValueChange={(value) => {
                      setGrantBuId(value);
                      setPrincipalKey("");
                    }}
                  >
                    <SelectTrigger id="grant-bu">
                      <SelectValue placeholder="Choose an owner BU" />
                    </SelectTrigger>
                    <SelectContent>
                      {setup.owners.map((owner) => (
                        <SelectItem key={owner.bu_id} value={owner.bu_id}>
                          {businessUnitDisplayName(buName.get(owner.bu_id))}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="grant-principal-type">Principal type</Label>
                  <Select
                    value={principalType}
                    onValueChange={(value) =>
                      setPrincipalKey(value === "group" ? "group:" : "user:")
                    }
                  >
                    <SelectTrigger id="grant-principal-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="group">Group</SelectItem>
                      <SelectItem value="user">Direct user</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="grant-principal">Principal</Label>
                  <Select
                    value={principalKey}
                    onValueChange={setPrincipalKey}
                    disabled={!grantBuId}
                  >
                    <SelectTrigger id="grant-principal">
                      <SelectValue placeholder="Choose a principal" />
                    </SelectTrigger>
                    <SelectContent>
                      {availablePrincipals.map((p) => (
                        <SelectItem
                          key={`${p.principal_type}:${p.principal_id}`}
                          value={`${p.principal_type}:${p.principal_id}`}
                        >
                          {principalDisplayLabel(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="grant-action">Action</Label>
                  <Select value={action} onValueChange={(value) => setAction(value as ReconAction)}>
                    <SelectTrigger id="grant-action">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {actionLabel[item]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2 xl:col-span-4">
                  <ReasonField
                    value={reason}
                    error={reasonError("grant", "Reason")}
                    onChange={(value) => {
                      setReason(value);
                      setAccessMessage("grant", null);
                    }}
                    id="grant-reason"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={!grantBuId || !principal || grantMutation.isPending}
                    onClick={() =>
                      requireReason("grant", "grant this reconciliation action", () =>
                        grantMutation.mutate(),
                      )
                    }
                  >
                    {grantMutation.isPending ? "Saving…" : "Grant action"}
                  </Button>
                  {accessMessageView("grant")}
                </div>
              </div>
            )}
            {!setup.multi_bu_governed && canAdminister && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                These grants are staged shadow data. They do not change effective access until a
                governed cutover succeeds.
              </p>
            )}
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[680px] text-left text-sm">
                <caption className="sr-only">
                  Persisted reconciliation business unit action grants
                </caption>
                <thead className="bg-muted/60">
                  <tr>
                    <th scope="col" className="p-3">
                      Business unit
                    </th>
                    <th scope="col" className="p-3">
                      Principal
                    </th>
                    {ACTIONS.map((item) => (
                      <th key={item} scope="col" className="p-3">
                        {actionLabel[item]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grantRows.length ? (
                    grantRows.map((grants) => {
                      const first = grants[0]!;
                      const p = setup.available_principals.find(
                        (choice) =>
                          choice.principal_type === first.principal_type &&
                          choice.principal_id === first.principal_id,
                      );
                      return (
                        <tr
                          key={`${first.bu_id}:${first.principal_type}:${first.principal_id}`}
                          className="border-t"
                        >
                          <td className="p-3">
                            {businessUnitDisplayName(buName.get(first.bu_id))}
                          </td>
                          <td className="p-3">
                            <Badge variant="outline" className="mr-2">
                              {first.principal_type === "group" ? "Group" : "Direct user"}
                            </Badge>
                            {principalDisplayLabel(p)}
                          </td>
                          {ACTIONS.map((item) => {
                            const actionGrant = grants.find((grant) => grant.action === item);
                            return (
                              <td key={item} className="p-3">
                                {actionGrant ? (
                                  <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                    <Check aria-hidden="true" className="h-4 w-4 text-primary" />
                                    <span className="sr-only">Granted</span>
                                    {canAdminister && (
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2"
                                        aria-label={`Revoke ${actionLabel[item]} for ${principalDisplayLabel(p)}`}
                                        disabled={revokeMutation.isPending}
                                        onClick={() =>
                                          requireReason(
                                            "revoke",
                                            `revoke ${actionLabel[item]} access for this principal`,
                                            () => revokeMutation.mutate(actionGrant.grant_id),
                                          )
                                        }
                                      >
                                        Revoke
                                      </Button>
                                    )}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground" aria-label="Not granted">
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={6} className="p-4 text-muted-foreground">
                        The access setup returned no explicit grants.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {canAdminister && (
              <div className="space-y-2">
                <ReasonField
                  value={reason}
                  error={reasonError("revoke", "Reason")}
                  onChange={(value) => {
                    setReason(value);
                    setAccessMessage("revoke", null);
                  }}
                  id="revoke-reason"
                />
                <p className="text-xs text-muted-foreground">
                  The reason above is recorded with each revoke.
                </p>
                {accessMessageView("revoke")}
              </div>
            )}
          </section>

          {((!setup.multi_bu_governed && canAdminister) || cutoverMutation.data) && (
            <section
              aria-labelledby="legacy-cutover-heading"
              className="space-y-3 rounded-md border p-4"
            >
              <div>
                <h3 id="legacy-cutover-heading" className="text-base font-semibold">
                  Legacy access cutover
                </h3>
                <p className="text-sm text-muted-foreground">
                  Choose separate active same-tenant maker and checker users. The database verifies
                  owner links, current BU assignments (including inherited assignments), required
                  action grants, and separation of duties when submitted.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="cutover-maker">Maker</Label>
                  <Select value={makerUserId} onValueChange={setMakerUserId}>
                    <SelectTrigger id="cutover-maker">
                      <SelectValue placeholder="Choose a maker" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers.map((user) => (
                        <SelectItem key={user.principal_id} value={user.principal_id}>
                          {principalDisplayLabel(user)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cutover-checker">Checker</Label>
                  <Select value={checkerUserId} onValueChange={setCheckerUserId}>
                    <SelectTrigger id="cutover-checker">
                      <SelectValue placeholder="Choose a different checker" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableUsers
                        .filter((user) => user.principal_id !== makerUserId)
                        .map((user) => (
                          <SelectItem key={user.principal_id} value={user.principal_id}>
                            {principalDisplayLabel(user)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <ReasonField
                value={reason}
                error={reasonError("cutover", "Reason")}
                onChange={(value) => {
                  setReason(value);
                  setAccessMessage("cutover", null);
                }}
                id="cutover-reason"
              />
              <p role="status" className="text-sm text-muted-foreground">
                {cutoverInputsReady && reasonReady
                  ? "Inputs are ready. Assignment, grant coverage, tenant membership, and cutover eligibility remain subject to authoritative database checks."
                  : "Select an owner mapping and two different active tenant users, then provide a reason (3–500 characters)."}
              </p>
              <Button
                type="button"
                disabled={
                  !cutoverInputsReady || cutoverMutation.isPending || Boolean(cutoverMutation.data)
                }
                onClick={() =>
                  requireReason("cutover", "record this legacy access cutover", () =>
                    cutoverMutation.mutate(),
                  )
                }
              >
                {cutoverMutation.isPending
                  ? "Checking eligibility…"
                  : cutoverMutation.data
                    ? "Cutover recorded"
                    : "Cut over legacy access"}
              </Button>
              {accessMessageView("cutover")}
              {cutoverMutation.data && (
                <Alert>
                  <ShieldCheck aria-hidden="true" />
                  <AlertTitle>Mapping cutover recorded</AlertTitle>
                  <AlertDescription>
                    The database returned a cutover receipt. Runtime authorization across APIs,
                    workers, and RLS still requires separate verification.
                  </AlertDescription>
                </Alert>
              )}
            </section>
          )}

          <section aria-labelledby="effective-heading" className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-md border p-4">
              <h3 id="effective-heading" className="flex items-center gap-2 font-semibold">
                <ShieldCheck aria-hidden="true" className="h-4 w-4 text-primary" />
                Your effective access
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Calculated by the shadow access service for your current identity within this
                tenant; it does not prove runtime API or RLS enforcement.
              </p>
              <ul className="mt-3 grid grid-cols-2 gap-2">
                {ACTIONS.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className={
                        setup.effective_access[item] ? "text-primary" : "text-muted-foreground"
                      }
                    >
                      {setup.effective_access[item] ? <Check className="h-4 w-4" /> : "—"}
                    </span>
                    {actionLabel[item]}
                    <span className="sr-only">
                      {setup.effective_access[item] ? "granted" : "not granted"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border p-4">
              <h3 className="font-semibold">Selected principal detail</h3>
              <Label htmlFor="selected-principal" className="mt-2 block">
                Review a persisted principal
              </Label>
              <Select value={selectedGrantKey} onValueChange={setSelectedGrantKey}>
                <SelectTrigger id="selected-principal">
                  <SelectValue placeholder="Choose a granted principal" />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Map(
                      setup.grants.map((grant) => [
                        `${grant.principal_type}:${grant.principal_id}`,
                        {
                          key: `${grant.principal_type}:${grant.principal_id}`,
                          label: principalDisplayLabel(
                            setup.available_principals.find(
                              (p) =>
                                p.principal_type === grant.principal_type &&
                                p.principal_id === grant.principal_id,
                            ),
                          ),
                          type: grant.principal_type,
                        },
                      ]),
                    ).values(),
                  ).map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.type === "group" ? "Group" : "Direct user"}: {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedGrantKey && (
                <div className="mt-3 text-sm">
                  <p className="font-medium">{principalDisplayLabel(selectedPrincipal)}</p>
                  <p className="mt-1 text-muted-foreground">Persisted grants for this principal:</p>
                  <ul className="mt-2 space-y-1">
                    {selectedPrincipalGrants.map((grant) => (
                      <li key={grant.grant_id}>
                        {businessUnitDisplayName(buName.get(grant.bu_id))} ·{" "}
                        {actionLabel[grant.action]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section
            aria-label="Tenant scope and governance disclosures"
            className="grid gap-4 lg:grid-cols-2"
          >
            <div className="rounded-md border p-4">
              <h3 className="font-semibold">Tenant-admin management scope</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Active tenant administrators manage ownership and grants within this tenant only. A
                role in another tenant does not transfer access here.
              </p>
              <Badge className="mt-3" variant={setup.is_tenant_admin ? "default" : "outline"}>
                {setup.is_tenant_admin
                  ? "Active tenant administrator"
                  : "Managed by active tenant administrators"}
              </Badge>
            </div>
            <div className="rounded-md border p-4">
              <h3 className="flex items-center gap-2 font-semibold">
                <LockKeyhole aria-hidden="true" className="h-4 w-4 text-primary" />
                Lock and maker-checker
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No lock-state field is returned, and this panel offers no lock or unlock action.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Retirement is separate: requester plus one different eligible approver; history is
                retained.
              </p>
            </div>
          </section>
        </CardContent>
      </Card>
    </section>
  );
}

function ReasonField({
  value,
  onChange,
  id,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>Reason for change</Label>
      <Input
        id={id}
        value={value}
        maxLength={500}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-help`}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Record why this access change is needed"
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <p id={`${id}-help`} className="text-xs text-muted-foreground">
          Required for audit history (3–500 characters).
        </p>
      )}
    </div>
  );
}
