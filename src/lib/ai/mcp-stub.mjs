// LL-077: stub for @ai-sdk/mcp (not used in SSR; see gateway-stub.mjs).
export const createMCPClient = () => { throw new Error('mcp not available in SSR') }
export class MCPError extends Error { constructor(msg) { super(msg); this.name = 'MCPError' } }
export const tool = () => null
export const jsonSchema = () => null
export default { createMCPClient, MCPError, tool, jsonSchema }
