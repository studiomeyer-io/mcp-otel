/**
 * mcp-otel — W3C Trace Context bridge for the Model Context Protocol.
 *
 * Propagate distributed-tracing context through MCP's `_meta` field and emit
 * OpenTelemetry spans with MCP/GenAI attributes, so a request flowing
 * Host -> MCP server -> tool -> downstream HTTP shows up as a single connected
 * trace in Jaeger / Tempo / Honeycomb / Datadog.
 *
 * @see https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/ (SEP-414)
 * @packageDocumentation
 */

// _meta key + attribute constants
export {
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  BAGGAGE_META_KEY,
  TRACE_META_KEYS,
  ATTR_MCP_METHOD,
  ATTR_MCP_TOOL_NAME,
  ATTR_MCP_REQUEST_ID,
  ATTR_MCP_SESSION_ID,
} from "./constants.js";

// Low-level propagation helpers
export {
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext,
  traceContextFields,
  spanContextToContext,
} from "./propagation.js";

// Span instrumentation
export {
  runInToolSpan,
  instrumentToolHandler,
} from "./instrument.js";

export type {
  ToolHandler,
  ToolHandlerExtra,
  InstrumentToolHandlerOptions,
} from "./instrument.js";

// Public types
export type {
  Meta,
  McpRequestLike,
  TraceContextOptions,
  InstrumentToolOptions,
  SpanBody,
  Context,
} from "./types.js";
