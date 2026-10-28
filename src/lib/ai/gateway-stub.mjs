// LL-077: stub for @ai-sdk/gateway. Not used in SSR (only AIDP imports it
// for type-check); Cloudflare Workers with nodeCompat doesn't polyfill
// node:fs which the real module reads at init time.
export const gateway = () => { throw new Error('gateway() not available in SSR') }
export const createGateway = gateway
export class GatewayError extends Error {
  constructor(msg, opts) { super(msg, opts); this.name = 'GatewayError' }
  static isInstance(error) { return error instanceof GatewayError || error?.name === 'GatewayError' }
}
export class GatewayAuthenticationError extends GatewayError {
  constructor(msg, opts) { super(msg, opts); this.name = 'GatewayAuthenticationError' }
  static isInstance(error) { return error instanceof GatewayAuthenticationError || error?.name === 'GatewayAuthenticationError' }
}
export class GatewayRateLimitError extends GatewayError {
  constructor(msg, opts) { super(msg, opts); this.name = 'GatewayRateLimitError' }
  static isInstance(error) { return error instanceof GatewayRateLimitError || error?.name === 'GatewayRateLimitError' }
}
export class GatewayConfigurationError extends GatewayError {
  constructor(msg, opts) { super(msg, opts); this.name = 'GatewayConfigurationError' }
  static isInstance(error) { return error instanceof GatewayConfigurationError || error?.name === 'GatewayConfigurationError' }
}
export const createGatewayProvider = gateway
export const dynamicGatewayProvider = gateway
export const embedGateway = gateway
export const experimental_customGatewayProvider = gateway
export default { gateway, createGateway, createGatewayProvider, dynamicGatewayProvider, embedGateway, experimental_customGatewayProvider, GatewayError, GatewayAuthenticationError, GatewayRateLimitError, GatewayConfigurationError }
