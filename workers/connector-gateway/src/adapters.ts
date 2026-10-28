export const REMOTE_GATEWAY_TYPES = [
  "s3",
  "azure_blob",
  "gcs",
  "bigquery",
  "snowflake",
  "databricks",
] as const;

export const AGENT_GATEWAY_TYPES = ["sftp", "ftp", "local", "network_drive"] as const;
export const GATEWAY_TYPES = [...REMOTE_GATEWAY_TYPES, ...AGENT_GATEWAY_TYPES] as const;
export type GatewayConnectorType = (typeof GATEWAY_TYPES)[number];

export type GatewayRequest = {
  connector_type: GatewayConnectorType;
  config: Record<string, unknown>;
  credential?: string | null;
};

export type GatewayResult = { rows: Record<string, unknown>[]; columns: string[] };

type FetchLike = typeof fetch;

function requiredString(config: Record<string, unknown>, name: string) {
  const value = config[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`missing_${name}`);
  return value.trim();
}

function parseCredential(raw: string | null | undefined) {
  if (!raw) return {} as Record<string, string>;
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value))
      return value as Record<string, string>;
  } catch {
    return { token: raw };
  }
  throw new Error("invalid_connector_credential");
}

function assertRemoteUrl(raw: string, allowed: (hostname: string) => boolean) {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !allowed(url.hostname.toLowerCase())
  ) {
    throw new Error("connector_endpoint_not_allowed");
  }
  if (/^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?)/u.test(url.hostname)) {
    throw new Error("connector_endpoint_not_allowed");
  }
  return url;
}

function columns(rows: Record<string, unknown>[]) {
  return [...new Set(rows.flatMap((row) => Object.keys(row)))];
}

function normalized(rows: unknown[]): GatewayResult {
  const objects = rows.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
  if (objects.length !== rows.length || objects.length > 50_000)
    throw new Error("invalid_connector_rows");
  return { rows: objects, columns: columns(objects) };
}

function parseCsv(text: string): GatewayResult {
  const lines = text
    .replace(/^\uFEFF/u, "")
    .split(/\r?\n/u)
    .filter(Boolean);
  if (!lines.length) return { rows: [], columns: [] };
  const parseLine = (line: string) => {
    const cells: string[] = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"' && quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) {
        cells.push(value);
        value = "";
      } else value += char;
    }
    cells.push(value);
    return cells;
  };
  const headers = parseLine(lines[0]).map((header) => header.trim());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header))
    throw new Error("invalid_csv_headers");
  const rows = lines
    .slice(1)
    .map((line) =>
      Object.fromEntries(headers.map((header, index) => [header, parseLine(line)[index] ?? ""])),
    );
  return { rows, columns: headers };
}

async function parseObjectResponse(response: Response) {
  if (!response.ok) throw new Error(`connector_upstream_${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const value = (await response.json()) as unknown;
    const rows = Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as { data?: unknown }).data)
        ? (value as { data: unknown[] }).data
        : [];
    return normalized(rows);
  }
  return parseCsv(await response.text());
}

async function objectStore(input: GatewayRequest, fetchImpl: FetchLike) {
  const url = requiredString(input.config, "url");
  const credential = parseCredential(input.credential);
  const allowed =
    input.connector_type === "s3"
      ? (host: string) =>
          host === "s3.amazonaws.com" ||
          host.endsWith(".s3.amazonaws.com") ||
          (host.includes(".s3.") && host.endsWith(".amazonaws.com"))
      : input.connector_type === "azure_blob"
        ? (host: string) => host.endsWith(".blob.core.windows.net")
        : (host: string) =>
            host === "storage.googleapis.com" || host.endsWith(".storage.googleapis.com");
  const endpoint = assertRemoteUrl(url, allowed);
  const headers: Record<string, string> = { accept: "application/json,text/csv" };
  const token = credential.bearer_token ?? credential.token;
  if (token) headers.authorization = `Bearer ${token}`;
  return parseObjectResponse(await fetchImpl(endpoint, { headers }));
}

async function bigQuery(input: GatewayRequest, fetchImpl: FetchLike) {
  const projectId = requiredString(input.config, "project_id");
  const query = requiredString(input.config, "query");
  const token =
    parseCredential(input.credential).bearer_token ?? parseCredential(input.credential).token;
  if (!token) throw new Error("connector_credential_required");
  const endpoint = assertRemoteUrl(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(projectId)}/queries`,
    (host) => host === "bigquery.googleapis.com",
  );
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      query,
      useLegacySql: false,
      maxResults: 50_000,
      location: input.config.location,
    }),
  });
  if (!response.ok) throw new Error(`connector_upstream_${response.status}`);
  const payload = (await response.json()) as {
    schema?: { fields?: Array<{ name?: string }> };
    rows?: Array<{ f?: Array<{ v?: unknown }> }>;
  };
  const fields = payload.schema?.fields?.map((field) => field.name ?? "").filter(Boolean) ?? [];
  return normalized(
    (payload.rows ?? []).map((row) =>
      Object.fromEntries(fields.map((field, index) => [field, row.f?.[index]?.v ?? null])),
    ),
  );
}

async function snowflake(input: GatewayRequest, fetchImpl: FetchLike) {
  const accountHost = requiredString(input.config, "account_host").toLowerCase();
  const endpoint = assertRemoteUrl(`https://${accountHost}/api/v2/statements`, (host) =>
    host.endsWith(".snowflakecomputing.com"),
  );
  const credential = parseCredential(input.credential);
  const token = credential.token ?? credential.bearer_token;
  if (!token) throw new Error("connector_credential_required");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      statement: requiredString(input.config, "statement"),
      timeout: 45,
      database: input.config.database,
      schema: input.config.schema,
      warehouse: input.config.warehouse,
      role: input.config.role,
    }),
  });
  if (!response.ok) throw new Error(`connector_upstream_${response.status}`);
  const payload = (await response.json()) as {
    resultSetMetaData?: { rowType?: Array<{ name?: string }> };
    data?: unknown[][];
  };
  const fields =
    payload.resultSetMetaData?.rowType?.map((field) => field.name ?? "").filter(Boolean) ?? [];
  return normalized(
    (payload.data ?? []).map((row) =>
      Object.fromEntries(fields.map((field, index) => [field, row[index] ?? null])),
    ),
  );
}

async function databricks(input: GatewayRequest, fetchImpl: FetchLike) {
  const workspaceHost = requiredString(input.config, "workspace_host").toLowerCase();
  const endpoint = assertRemoteUrl(
    `https://${workspaceHost}/api/2.0/sql/statements`,
    (host) => host.endsWith(".cloud.databricks.com") || host.endsWith(".azuredatabricks.net"),
  );
  const credential = parseCredential(input.credential);
  const token = credential.token ?? credential.bearer_token;
  if (!token) throw new Error("connector_credential_required");
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      warehouse_id: requiredString(input.config, "warehouse_id"),
      statement: requiredString(input.config, "statement"),
      catalog: input.config.catalog,
      schema: input.config.schema,
      wait_timeout: "45s",
      disposition: "INLINE",
    }),
  });
  if (!response.ok) throw new Error(`connector_upstream_${response.status}`);
  const payload = (await response.json()) as {
    manifest?: { schema?: { columns?: Array<{ name?: string }> } };
    result?: { data_array?: unknown[][] };
  };
  const fields =
    payload.manifest?.schema?.columns?.map((field) => field.name ?? "").filter(Boolean) ?? [];
  return normalized(
    (payload.result?.data_array ?? []).map((row) =>
      Object.fromEntries(fields.map((field, index) => [field, row[index] ?? null])),
    ),
  );
}

export async function runGatewayConnector(
  input: GatewayRequest,
  fetchImpl: FetchLike = fetch,
): Promise<GatewayResult> {
  if (!(GATEWAY_TYPES as readonly string[]).includes(input.connector_type))
    throw new Error("unsupported_connector_type");
  if ((AGENT_GATEWAY_TYPES as readonly string[]).includes(input.connector_type))
    throw new Error("connector_agent_required");
  if (["s3", "azure_blob", "gcs"].includes(input.connector_type))
    return objectStore(input, fetchImpl);
  if (input.connector_type === "bigquery") return bigQuery(input, fetchImpl);
  if (input.connector_type === "snowflake") return snowflake(input, fetchImpl);
  return databricks(input, fetchImpl);
}
