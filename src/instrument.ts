import {
  type Span,
  type Tracer,
  SpanKind,
  SpanStatusCode,
  context as otelContext,
  trace,
} from "@opentelemetry/api";

import {
  ATTR_MCP_METHOD,
  ATTR_MCP_REQUEST_ID,
  ATTR_MCP_SESSION_ID,
  ATTR_MCP_TOOL_NAME,
} from "./constants.js";
import { extractTraceContext } from "./propagation.js";
import type {
  InstrumentToolOptions,
  Meta,
  SpanBody,
} from "./types.js";

const TRACER_NAME = "mcp-otel";
const DEFAULT_METHOD = "tools/call";

function resolveTracer(tracer?: Tracer): Tracer {
  return tracer ?? trace.getTracer(TRACER_NAME);
}

function spanName(method: string, toolName?: string): string {
  // Follows the OTel "<operation> <target>" span-name convention, e.g.
  // `tools/call weather.lookup`.
  return toolName ? `${method} ${toolName}` : method;
}

function buildAttributes(
  options: InstrumentToolOptions,
): Record<string, string | number | boolean> {
  const method = options.method ?? DEFAULT_METHOD;
  const attrs: Record<string, string | number | boolean> = {
    [ATTR_MCP_METHOD]: method,
    ...options.attributes,
  };
  if (options.toolName !== undefined) attrs[ATTR_MCP_TOOL_NAME] = options.toolName;
  if (options.requestId !== undefined) {
    attrs[ATTR_MCP_REQUEST_ID] = String(options.requestId);
  }
  if (options.sessionId !== undefined) attrs[ATTR_MCP_SESSION_ID] = options.sessionId;
  return attrs;
}

/**
 * End a span based on the outcome of the body. On a thrown error the exception
 * is recorded and the span status is set to ERROR; otherwise OK.
 */
function finishSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

function finishSpanError(span: Span, err: unknown): void {
  const error =
    err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
  span.recordException(error);
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.end();
}

/**
 * Run `body` inside a SERVER span whose parent is the trace context carried by
 * `meta`. This is the low-level primitive the wrapper helpers build on; use it
 * directly when you control the call site and have the `_meta` object at hand.
 *
 * - Extracts the parent context from `meta.traceparent` / `tracestate` /
 *   `baggage` (deterministically, from `ROOT_CONTEXT`).
 * - Starts a span with the MCP/GenAI attributes from `options`.
 * - Makes that span the active context for the duration of `body`.
 * - Ends the span with OK / ERROR status and records thrown exceptions.
 *
 * The span result is the body's return value. Errors are re-thrown after the
 * span is closed, so callers see normal control flow.
 *
 * @example
 * ```ts
 * const result = await runInToolSpan(
 *   ctx.mcpReq._meta,
 *   { toolName: "weather.lookup", requestId: ctx.requestId },
 *   async (span) => {
 *     span.setAttribute("weather.city", city);
 *     return await lookup(city);
 *   },
 * );
 * ```
 */
export async function runInToolSpan<T>(
  meta: Meta | undefined,
  options: InstrumentToolOptions,
  body: SpanBody<T>,
): Promise<T> {
  const tracer = resolveTracer(options.tracer);
  const method = options.method ?? DEFAULT_METHOD;
  const parentContext = extractTraceContext(meta);

  const span = tracer.startSpan(
    spanName(method, options.toolName),
    {
      kind: SpanKind.SERVER,
      attributes: buildAttributes(options),
    },
    parentContext,
  );

  const activeContext = trace.setSpan(parentContext, span);

  try {
    const result = await otelContext.with(activeContext, () => body(span));
    finishSpanOk(span);
    return result;
  } catch (err) {
    finishSpanError(span, err);
    throw err;
  }
}

/**
 * The shape of the `extra`/`ctx` object an MCP tool handler receives as its
 * second argument. Structural and permissive so it matches several SDK
 * versions: the published 1.x line exposes a flat `extra._meta` (and
 * `extra.requestId` / `extra.sessionId`), while the 2.0 line nests it under
 * `extra.mcpReq._meta`. The default meta-extractor checks both.
 */
export interface ToolHandlerExtra {
  mcpReq?: { _meta?: Meta };
  _meta?: Meta;
  requestId?: string | number;
  sessionId?: string;
  [key: string]: unknown;
}

/**
 * A tool handler as registered with `server.registerTool(name, schema, handler)`
 * in the `@modelcontextprotocol/sdk`: `(args, extra) => result`.
 */
export type ToolHandler<Args, Result> = (
  args: Args,
  extra: ToolHandlerExtra,
) => Result | Promise<Result>;

/**
 * Options for {@link instrumentToolHandler}. In addition to the span options,
 * you can override how `_meta` and identifiers are pulled from the handler's
 * `extra` argument — useful if your SDK version exposes them differently.
 */
export interface InstrumentToolHandlerOptions
  extends Omit<InstrumentToolOptions, "requestId" | "sessionId"> {
  /**
   * Extract the `_meta` object from the handler's `extra` argument.
   * Default: `extra.mcpReq?._meta ?? extra._meta`.
   */
  getMeta?: (extra: ToolHandlerExtra) => Meta | undefined;
  /**
   * Extract the MCP request id. Default: `extra.requestId`.
   */
  getRequestId?: (extra: ToolHandlerExtra) => string | number | undefined;
  /**
   * Extract the MCP session id. Default: `extra.sessionId`.
   */
  getSessionId?: (extra: ToolHandlerExtra) => string | undefined;
}

const defaultGetMeta = (extra: ToolHandlerExtra): Meta | undefined =>
  extra.mcpReq?._meta ?? extra._meta;

/**
 * Wrap an MCP tool handler so every call runs inside a properly-parented
 * SERVER span. Drop-in: the returned function has the same
 * `(args, extra) => result` signature, so you can register it exactly where you
 * would register the original handler.
 *
 * The wrapper reads the W3C trace context the *caller* placed in
 * `extra._meta` (or `extra.mcpReq._meta` on SDK 2.x), starts a child span (so the host's span becomes the
 * parent), runs your handler with that span active, and closes the span with
 * OK/ERROR status. Any span you start inside the handler — or any downstream
 * HTTP call that injects the active context — is automatically a descendant,
 * giving you one connected trace from host to downstream.
 *
 * @param toolName  The tool's name (used for span name + `mcp.tool.name`).
 * @param handler   The original tool handler.
 * @param options   Span + extraction options.
 *
 * @example
 * ```ts
 * server.registerTool(
 *   "weather.lookup",
 *   { description: "...", inputSchema: { city: z.string() } },
 *   instrumentToolHandler("weather.lookup", async ({ city }) => {
 *     // ...your logic; the active span is the MCP server span
 *     return { content: [{ type: "text", text: `Weather for ${city}` }] };
 *   }),
 * );
 * ```
 */
export function instrumentToolHandler<Args, Result>(
  toolName: string,
  handler: ToolHandler<Args, Result>,
  options: InstrumentToolHandlerOptions = {},
): ToolHandler<Args, Result> {
  const getMeta = options.getMeta ?? defaultGetMeta;
  const getRequestId = options.getRequestId ?? ((extra) => extra.requestId);
  const getSessionId = options.getSessionId ?? ((extra) => extra.sessionId);

  return (args: Args, extra: ToolHandlerExtra): Promise<Result> => {
    const meta = getMeta(extra);
    const requestId = getRequestId(extra);
    const sessionId = getSessionId(extra);

    const spanOptions: InstrumentToolOptions = {
      toolName,
      method: options.method ?? DEFAULT_METHOD,
      ...(options.tracer !== undefined ? { tracer: options.tracer } : {}),
      ...(options.attributes !== undefined ? { attributes: options.attributes } : {}),
      ...(requestId !== undefined ? { requestId } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
    };

    return runInToolSpan(meta, spanOptions, () => handler(args, extra));
  };
}
