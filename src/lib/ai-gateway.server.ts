/**
 * @deprecated — Use `@/lib/ai/provider-router.server` directly.
 *
 * This file remains only as a thin backwards-compatibility shim while
 * remaining call sites migrate to the ReconIQ AI Provider Router. All runtime
 * behavior is delegated to `provider-router.server.ts`. No Meta-branded
 * headers, endpoints, or default gateway URLs are set here.
 */

export {
  assertResidencyCompliant,
  createFviAiProvider,
  createFviAiProvider as createMetaAiGatewayProvider,
  FVI_AI_DEFAULT_BASE_URL,
  FVI_AI_DEFAULT_BASE_URL as META_AI_GATEWAY_DEFAULT_BASE_URL,
  resolveFviAiBaseUrl,
  resolveFviAiBaseUrl as resolveMetaGatewayBaseUrl,
  resolvePlatformAiApiKey,
} from "@/lib/ai/provider-router.server";
export type { ResidencyContext } from "@/lib/ai/provider-router.server";
