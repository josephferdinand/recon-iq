import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GovernanceMembershipApprovals } from "@/components/governance-membership-approvals";
import { GovernanceAccessReviews } from "@/components/governance-access-reviews";
import { GovernanceAuditTrail } from "@/components/governance-audit-trail";
import { listGovernanceMembershipRequests } from "@/lib/governance-membership.functions";
import { listGovernanceAccessReviews } from "@/lib/governance-access-review.functions";
import { listGovernanceAuditTrail } from "@/lib/governance-audit.functions";

export type GovernanceView = "membership" | "reviews" | "audit";
export type GovernanceEnvironment = "PROD" | "DEV" | "UAT" | "STAGING" | string;
const ApplicationEnvironmentContext = createContext<GovernanceEnvironment | null>(null);
export function GovernanceApplicationEnvironmentProvider({
  environment,
  children,
}: {
  environment: GovernanceEnvironment;
  children: ReactNode;
}) {
  return (
    <ApplicationEnvironmentContext.Provider value={environment}>
      {children}
    </ApplicationEnvironmentContext.Provider>
  );
}

const views: { id: GovernanceView; label: string; title: string; subtitle: string }[] = [
  {
    id: "membership",
    label: "Membership approvals",
    title: "Membership approvals",
    subtitle:
      "Review who requested access, their team and the exact rights before an independent decision.",
  },
  {
    id: "reviews",
    label: "Access reviews",
    title: "Access reviews",
    subtitle:
      "Certify current access by member, team and environment. Retain, request a change or revoke with a reason.",
  },
  {
    id: "audit",
    label: "Audit trail",
    title: "Audit trail",
    subtitle:
      "Trace who requested, reviewed and applied each action. Decisions and confirmed outcomes remain distinct.",
  },
];

export function GovernanceApprovalQueue({
  tenantId,
  tenantSlug,
  initialView = "membership",
}: {
  tenantId: string;
  tenantSlug: string;
  initialView?: GovernanceView;
}) {
  const [view, setView] = useState<GovernanceView>(initialView);
  const applicationEnvironment = useContext(ApplicationEnvironmentContext);
  const membershipList = useServerFn(listGovernanceMembershipRequests);
  const reviewList = useServerFn(listGovernanceAccessReviews);
  const auditList = useServerFn(listGovernanceAuditTrail);
  const membershipAccess = useQuery({
    queryKey: [
      "governance-membership-requests",
      { tenant_id: tenantId, page: 1, page_size: 10, search: "" },
    ],
    queryFn: () =>
      membershipList({ data: { tenant_id: tenantId, page: 1, page_size: 10, search: "" } }),
  });
  const reviewAccess = useQuery({
    queryKey: ["governance-access-review-access", tenantId],
    queryFn: () =>
      reviewList({ data: { tenant_id: tenantId, page: 1, page_size: 10, search: "" } }),
  });
  const auditAccess = useQuery({
    queryKey: ["governance-audit-access", tenantId],
    queryFn: () => auditList({ data: { tenant_id: tenantId, page: 1, page_size: 10 } }),
  });
  const allowed = useMemo(
    () =>
      [
        membershipAccess.data?.permissions.can_review_queue ||
        membershipAccess.data?.permissions.can_submit
          ? "membership"
          : null,
        reviewAccess.data?.permissions.can_decide ||
        reviewAccess.data?.permissions.can_create_campaign
          ? "reviews"
          : null,
        auditAccess.data?.permissions.read ? "audit" : null,
      ].filter((item): item is GovernanceView => item !== null),
    [
      membershipAccess.data?.permissions,
      reviewAccess.data?.permissions,
      auditAccess.data?.permissions,
    ],
  );
  const permissionCheckPending =
    membershipAccess.isPending || reviewAccess.isPending || auditAccess.isPending;
  useEffect(() => {
    if (!permissionCheckPending && !allowed.includes(view) && allowed[0]) setView(allowed[0]);
  }, [allowed, permissionCheckPending, view]);
  const selected = views.find((item) => item.id === view)!;
  return (
    <div className="min-w-0 text-slate-900" data-tenant-slug={tenantSlug}>
      <header className="mb-6 border-b border-slate-200 pb-5">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-slate-600">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            <span>{tenantSlug}</span>
            <span aria-hidden="true">/</span>
            <span>Tenant administration</span>
            <span aria-hidden="true">/</span>
            <span>Governance</span>
          </div>
          <Badge
            variant="outline"
            aria-label="Application environment"
            className="border-slate-300 text-slate-700"
          >
            {applicationEnvironment ?? "Environment unavailable"}
          </Badge>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-slate-950">
              {selected.title}
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">{selected.subtitle}</p>
          </div>
          {view !== "audit" && auditAccess.data?.permissions.read && (
            <Button variant="outline" onClick={() => setView("audit")}>
              View audit trail
            </Button>
          )}
        </div>
        {permissionCheckPending ? (
          <div role="status" className="mt-5 text-sm text-slate-600">
            Checking your current tenant permissions…
          </div>
        ) : (
          allowed.length > 0 && (
            <nav aria-label="Governance views" className="mt-5 flex gap-2 overflow-x-auto pb-1">
              {views
                .filter((item) => allowed.includes(item.id))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={view === item.id ? "page" : undefined}
                    onClick={() => setView(item.id)}
                    className={`shrink-0 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2 ${view === item.id ? "border-[#caa33e] bg-[#caa33e] text-slate-950" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
                  >
                    {item.label}
                  </button>
                ))}
            </nav>
          )
        )}
      </header>
      {permissionCheckPending ? (
        <GovernanceLoading label="your authorized governance views" />
      ) : allowed.length === 0 ? (
        <GovernanceError
          message="No governance view is available under your current tenant permissions."
          onRetry={() => {
            void membershipAccess.refetch();
            void reviewAccess.refetch();
            void auditAccess.refetch();
          }}
        />
      ) : view === "membership" && allowed.includes("membership") ? (
        <GovernanceMembershipApprovals key={tenantId} tenantId={tenantId} />
      ) : view === "reviews" && allowed.includes("reviews") ? (
        <GovernanceAccessReviews key={tenantId} tenantId={tenantId} />
      ) : view === "audit" && allowed.includes("audit") ? (
        <GovernanceAuditTrail key={tenantId} tenantId={tenantId} />
      ) : (
        <GovernanceLoading label="your authorized governance view" />
      )}
    </div>
  );
}

import { GovernanceLoading, GovernanceError } from "@/components/governance-review-detail";
