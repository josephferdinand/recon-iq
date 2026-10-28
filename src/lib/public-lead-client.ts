const PROD_MARKETING_HOSTS = new Set(["reconiq.example", "www.reconiq.example"]);
const PROD_APP_ORIGIN = "https://app.reconiq.example";
const LEAD_PATH = "/api/public/mkt-leads";

export function publicLeadEndpoint(pageOrigin: string, configuredAppOrigin?: string): string {
  const page = new URL(pageOrigin);
  const isLocal = page.hostname === "localhost" || page.hostname === "127.0.0.1";

  if (PROD_MARKETING_HOSTS.has(page.hostname)) {
    if (configuredAppOrigin && new URL(configuredAppOrigin).origin !== PROD_APP_ORIGIN) {
      throw new Error("Marketing API environment does not match this site.");
    }
    return new URL(LEAD_PATH, PROD_APP_ORIGIN).toString();
  }

  if (page.hostname === "app.reconiq.example") return new URL(LEAD_PATH, PROD_APP_ORIGIN).toString();
  if (page.hostname === "dev.app.reconiq.example") return new URL(LEAD_PATH, page).toString();

  if (configuredAppOrigin) {
    const app = new URL(configuredAppOrigin);
    if (app.hostname === "app.reconiq.example") {
      throw new Error("Non-production marketing cannot submit to the production app.");
    }
    if (app.protocol !== "https:" && !(isLocal && app.hostname === "localhost")) {
      throw new Error("Marketing API must use HTTPS outside local development.");
    }
    return new URL(LEAD_PATH, app).toString();
  }

  if (isLocal) return new URL(LEAD_PATH, page).toString();
  throw new Error("Marketing API environment is not configured.");
}

export async function parsePublicLeadResponse(response: Response): Promise<{
  ok: true;
  lead_id: string;
  score: number;
  temperature: string;
  notification_queued: boolean;
}> {
  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    lead_id?: string;
    score?: number;
    temperature?: string;
    notification_queued?: boolean;
    error?: string;
  } | null;

  if (!response.ok || body?.ok !== true || typeof body.lead_id !== "string") {
    if (body?.error === "validation_failed") throw new Error("Please check the required fields and try again.");
    if (body?.error === "rate_limit_exceeded") throw new Error("Too many requests. Please try again shortly.");
    throw new Error("We could not submit your request. Please try again or email support@reconiq.example.");
  }

  return {
    ok: true,
    lead_id: body.lead_id,
    score: typeof body.score === "number" ? body.score : 0,
    temperature: typeof body.temperature === "string" ? body.temperature : "received",
    notification_queued: body.notification_queued === true,
  };
}
