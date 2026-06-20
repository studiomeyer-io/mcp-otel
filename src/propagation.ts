import {
  type Context,
  type SpanContext,
  ROOT_CONTEXT,
  TraceFlags,
  context as otelContext,
  defaultTextMapGetter,
  defaultTextMapSetter,
  trace,
} from "@opentelemetry/api";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";

import {
  BAGGAGE_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
} from "./constants.js";
import type { Meta } from "./types.js";

const INVALID_TRACE_ID = "00000000000000000000000000000000";
const INVALID_SPAN_ID = "0000000000000000";
const VERSION_FORBIDDEN = "ff";

const HEX32 = /^[0-9a-f]{32}$/;
const HEX16 = /^[0-9a-f]{16}$/;
const HEX2 = /^[0-9a-f]{2}$/;

/**
 * A single propagator instance that handles both `traceparent`/`tracestate`
 * (W3C Trace Context) and `baggage` (W3C Baggage). Reused across calls — it is
 * stateless and cheap to share.
 */
const propagator = new CompositePropagator({
  propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()],
});

/**
 * Parse a W3C `traceparent` string into a {@link SpanContext}.
 *
 * Format: `version "-" trace-id "-" parent-id "-" trace-flags`, e.g.
 * `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`.
 *
 * Returns `null` for any malformed, forbidden (`ff` version) or all-zero
 * (invalid) value, following the W3C spec. The returned span context is always
 * marked `isRemote: true`.
 */
export function parseTraceparent(traceparent: string): SpanContext | null {
  if (typeof traceparent !== "string") return null;

  const parts = traceparent.split("-");
  if (parts.length !== 4) return null;

  const [version, traceId, spanId, flags] = parts as [
    string,
    string,
    string,
    string,
  ];

  // version: exactly 2 lowercase hex; "ff" is explicitly forbidden by the spec.
  if (!HEX2.test(version) || version === VERSION_FORBIDDEN) return null;

  if (!HEX32.test(traceId) || traceId === INVALID_TRACE_ID) return null;
  if (!HEX16.test(spanId) || spanId === INVALID_SPAN_ID) return null;
  if (!HEX2.test(flags)) return null;

  const traceFlags = parseInt(flags, 16);
  if (Number.isNaN(traceFlags)) return null;

  return {
    traceId,
    spanId,
    // Only the lowest bit (sampled) is defined today; mask off the rest so an
    // unknown future flag can't accidentally flip sampling semantics.
    traceFlags: traceFlags & TraceFlags.SAMPLED,
    isRemote: true,
  };
}

/**
 * Serialize a {@link SpanContext} into a W3C `traceparent` string.
 *
 * Always emits version `00`. Returns `null` when the span context is invalid
 * (wrong-length or all-zero ids), so callers can decide how to handle it rather
 * than emitting a broken header.
 */
export function formatTraceparent(spanContext: SpanContext): string | null {
  if (!spanContext) return null;

  const { traceId, spanId, traceFlags } = spanContext;
  if (!HEX32.test(traceId) || traceId === INVALID_TRACE_ID) return null;
  if (!HEX16.test(spanId) || spanId === INVALID_SPAN_ID) return null;

  // On output we preserve all 8 flag bits (mask 0xff), unlike parse() which
  // keeps only the sampled bit: per W3C trace-context a propagator should
  // forward unknown flag bits unchanged. In practice an OTel SpanContext only
  // carries the sampled bit, so the two paths never disagree on real data.
  const flags = ((traceFlags ?? TraceFlags.NONE) & 0xff)
    .toString(16)
    .padStart(2, "0");

  return `00-${traceId}-${spanId}-${flags}`;
}

/**
 * Extract a parent OpenTelemetry {@link Context} from an MCP `_meta` object.
 *
 * Reads `traceparent`, `tracestate` and `baggage` (the spec-reserved keys) and
 * returns a context with the remote span + baggage attached. If `_meta` carries
 * no valid trace context, the returned context equals the (passed or root) base
 * context, so it is always safe to start a span against it.
 *
 * @param meta  The `_meta` object from `request.params._meta` (may be undefined).
 * @param base  Base context to extract into. Defaults to `ROOT_CONTEXT` so the
 *              result is deterministic and independent of any ambient context.
 */
export function extractTraceContext(
  meta: Meta | undefined,
  base: Context = ROOT_CONTEXT,
): Context {
  if (!meta) return base;

  // Build a string-only carrier the propagator understands. Non-string values
  // for the reserved keys are ignored (the spec mandates string values).
  const carrier: Record<string, string> = {};
  const tp = meta[TRACEPARENT_META_KEY];
  const ts = meta[TRACESTATE_META_KEY];
  const bg = meta[BAGGAGE_META_KEY];
  if (typeof tp === "string") carrier[TRACEPARENT_META_KEY] = tp;
  if (typeof ts === "string") carrier[TRACESTATE_META_KEY] = ts;
  if (typeof bg === "string") carrier[BAGGAGE_META_KEY] = bg;

  return propagator.extract(base, carrier, defaultTextMapGetter);
}

/**
 * Inject the trace context of `context` into an MCP `_meta` object.
 *
 * Writes `traceparent`, `tracestate` and `baggage` keys (whichever apply) so an
 * MCP **client** can propagate its active trace to the server through the
 * request `_meta`. Mutates and returns the same `_meta` object, creating one if
 * `undefined` was passed.
 *
 * @param meta     The `_meta` object to write into (mutated in place).
 * @param context  Context to inject. Defaults to the current active context.
 */
export function injectTraceContext(
  meta: Meta | undefined,
  context?: Context,
): Meta {
  const target: Meta = meta ?? {};
  const ctx = context ?? otelContext.active();
  propagator.inject(
    ctx,
    target as Record<string, unknown>,
    defaultTextMapSetter,
  );
  return target;
}

/**
 * The `_meta` keys this library reads/writes for propagation. Useful for callers
 * that want to strip trace keys before forwarding `_meta` elsewhere.
 */
export function traceContextFields(): string[] {
  return propagator.fields();
}

/**
 * Turn a {@link SpanContext} into a context object, so callers can inject a span
 * context they hold directly (without it being the active span).
 */
export function spanContextToContext(
  spanContext: SpanContext,
  base: Context = ROOT_CONTEXT,
): Context {
  return trace.setSpanContext(base, spanContext);
}
