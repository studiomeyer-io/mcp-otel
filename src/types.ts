import type { Context, Span, Tracer } from "@opentelemetry/api";

/**
 * An MCP `_meta` object as it appears inside `params._meta` of a request.
 * Keys are strings; values are arbitrary JSON. The trace keys
 * (`traceparent`, `tracestate`, `baggage`) carry W3C-formatted strings.
 */
export type Meta = Record<string, unknown>;

/**
 * The subset of an MCP request we need to instrument a tool call. Kept
 * structural on purpose so it works with the `@modelcontextprotocol/sdk`
 * request shape (`{ params: { name, _meta, arguments } }`) without importing
 * the SDK as a hard dependency.
 */
export interface McpRequestLike {
  method?: string;
  params?: {
    name?: string;
    _meta?: Meta;
    [key: string]: unknown;
  };
}

/**
 * Options shared by the instrumentation helpers.
 */
export interface TraceContextOptions {
  /**
   * Tracer to use. Defaults to `trace.getTracer("mcp-otel")` from the global
   * provider. Pass your own to control instrumentation scope name/version.
   */
  tracer?: Tracer;
}

/**
 * Options for {@link instrumentToolHandler} / {@link runInToolSpan}.
 */
export interface InstrumentToolOptions extends TraceContextOptions {
  /**
   * The MCP method being handled. Defaults to `"tools/call"`.
   */
  method?: string;
  /**
   * The tool name, used for the span name (`<method> <tool>`, e.g.
   * `tools/call weather.lookup`) and the `mcp.tool.name` attribute. If omitted,
   * the helper tries to read it from the request's `params.name`.
   */
  toolName?: string;
  /**
   * The MCP request id, recorded as `mcp.request.id`.
   */
  requestId?: string | number;
  /**
   * An MCP session id, recorded as `mcp.session.id` when present.
   */
  sessionId?: string;
  /**
   * Extra attributes to set on the span at creation time.
   */
  attributes?: Record<string, string | number | boolean>;
}

/**
 * A function that runs inside an instrumented span. The active span is passed
 * so the handler can add attributes/events. The library starts and ends the
 * span, and records exceptions/errors automatically.
 */
export type SpanBody<T> = (span: Span) => T | Promise<T>;

/**
 * Re-export of the OpenTelemetry `Context` type for convenience.
 */
export type { Context };
