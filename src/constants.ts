/**
 * The MCP specification (SEP-414, RC 2026-07-28) reserves these *unprefixed*
 * `_meta` keys for distributed tracing. They follow the W3C Trace Context and
 * W3C Baggage formats and travel inside `params._meta` of every MCP request.
 *
 * @see https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
 * @see https://www.w3.org/TR/trace-context/
 * @see https://www.w3.org/TR/baggage/
 */
export const TRACEPARENT_META_KEY = "traceparent" as const;
export const TRACESTATE_META_KEY = "tracestate" as const;
export const BAGGAGE_META_KEY = "baggage" as const;

/**
 * All trace-related `_meta` keys, bundled for convenience.
 */
export const TRACE_META_KEYS = {
  traceparent: TRACEPARENT_META_KEY,
  tracestate: TRACESTATE_META_KEY,
  baggage: BAGGAGE_META_KEY,
} as const;

/**
 * Semantic-convention attribute keys this library sets on spans.
 *
 * `mcp.*` keys are not (yet) part of the stable OpenTelemetry semantic
 * conventions, so we define them here explicitly rather than importing them
 * from `@opentelemetry/semantic-conventions`. They mirror the wording used in
 * the MCP spec (`tools/call`, tool `name`, request `id`).
 */
export const ATTR_MCP_METHOD = "mcp.method" as const;
export const ATTR_MCP_TOOL_NAME = "mcp.tool.name" as const;
export const ATTR_MCP_REQUEST_ID = "mcp.request.id" as const;
export const ATTR_MCP_SESSION_ID = "mcp.session.id" as const;
