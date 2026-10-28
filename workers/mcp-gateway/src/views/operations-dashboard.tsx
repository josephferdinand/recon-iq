import "../index.css";
import { useToolInfo } from "../helpers.js";

type Recon = { id: string; name: string; status: string; recon_type: string; latest_run?: { status?: string; matched_count?: number; exception_count?: number } | null };
type Connector = { id: string; name: string; connector_type: string; enabled: boolean; last_status?: string | null; execution_mode: string };

export default function OperationsDashboard() {
  const { input, output, isPending } = useToolInfo<"view_operations_dashboard">();
  if (isPending) return <main className="shell" aria-busy="true">Loading authorized FVI operations…</main>;
  const payload = output?.data as {
    tenant_slug?: string;
    refreshed_at?: string;
    reconciliations?: { data?: Recon[] };
    connectors?: { data?: Connector[] };
    reports?: { standard?: Array<{ id: string; name: string }> };
  } | undefined;
  const reconciliations = payload?.reconciliations?.data ?? [];
  const connectors = payload?.connectors?.data ?? [];
  const reports = payload?.reports?.standard ?? [];
  const openBreaks = reconciliations.reduce((sum, item) => sum + Number(item.latest_run?.exception_count ?? 0), 0);
  const matched = reconciliations.reduce((sum, item) => sum + Number(item.latest_run?.matched_count ?? 0), 0);

  return (
    <main className="shell" data-llm={`FVI tenant ${payload?.tenant_slug ?? input?.tenant_slug}; ${reconciliations.length} reconciliations; ${openBreaks} latest-run exceptions`}>
      <header><div><p className="eyebrow">ReconIQ</p><h1>Operations assurance</h1></div><div className="tenant"><span>Tenant</span><strong>{payload?.tenant_slug ?? input?.tenant_slug}</strong></div></header>
      <section className="metrics" aria-label="Operational summary">
        <article><span>Reconciliations</span><strong>{reconciliations.length}</strong></article>
        <article><span>Latest matches</span><strong>{matched.toLocaleString()}</strong></article>
        <article><span>Latest exceptions</span><strong>{openBreaks.toLocaleString()}</strong></article>
        <article><span>Connectors</span><strong>{connectors.length}</strong></article>
      </section>
      <section className="panel"><div className="panel-title"><h2>Reconciliation health</h2><span>{reconciliations.filter((r) => r.status === "active").length} active</span></div><div className="rows">{reconciliations.slice(0, 8).map((item) => <div className="row" key={item.id}><div><strong>{item.name}</strong><small>{item.recon_type.replaceAll("_", " ")}</small></div><span className={`pill ${item.latest_run?.status === "failed" ? "bad" : "good"}`}>{item.latest_run?.status ?? "not run"}</span></div>)}</div></section>
      <section className="two-column">
        <div className="panel"><div className="panel-title"><h2>Connectors</h2><span>{connectors.filter((c) => c.enabled).length} enabled</span></div><div className="rows">{connectors.slice(0, 6).map((item) => <div className="row" key={item.id}><div><strong>{item.name}</strong><small>{item.connector_type} · {item.execution_mode.replaceAll("_", " ")}</small></div><span className={`pill ${item.last_status === "failed" ? "bad" : "neutral"}`}>{item.last_status ?? "ready"}</span></div>)}</div></div>
        <div className="panel"><div className="panel-title"><h2>Reports</h2><span>{reports.length} available</span></div><div className="rows">{reports.map((item) => <div className="row" key={item.id}><div><strong>{item.name}</strong><small>{item.id}</small></div><span className="pill neutral">JSON · CSV</span></div>)}</div></div>
      </section>
      <footer>Refreshed {payload?.refreshed_at ? new Date(payload.refreshed_at).toLocaleString() : "just now"}. FVI remains the authorization and audit authority.</footer>
    </main>
  );
}
