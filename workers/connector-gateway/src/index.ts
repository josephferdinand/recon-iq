import { GATEWAY_TYPES, runGatewayConnector, type GatewayRequest } from "./adapters";

const MAX_BODY_BYTES = 128_000;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "fvi-connector-gateway",
        connector_types: GATEWAY_TYPES,
      });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/pull")
      return Response.json({ error: "not_found" }, { status: 404 });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
      return Response.json({ error: "payload_too_large" }, { status: 413 });
    let input: GatewayRequest;
    try {
      input = (await request.json()) as GatewayRequest;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    try {
      const result = await runGatewayConnector(input);
      return Response.json(result);
    } catch (error) {
      const code = error instanceof Error ? error.message : "connector_gateway_failed";
      const status =
        code === "connector_agent_required"
          ? 424
          : code.startsWith("missing_") ||
              code.includes("required") ||
              code.includes("invalid_") ||
              code.includes("not_allowed")
            ? 422
            : 502;
      return Response.json({ error: code }, { status });
    }
  },
};
