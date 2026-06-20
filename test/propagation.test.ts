import { TraceFlags, propagation, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it } from "vitest";

import {
  BAGGAGE_META_KEY,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
  extractTraceContext,
  formatTraceparent,
  injectTraceContext,
  parseTraceparent,
  spanContextToContext,
  traceContextFields,
} from "../src/index.js";
import {
  SAMPLE_SPAN_ID,
  SAMPLE_TRACEPARENT,
  SAMPLE_TRACE_ID,
} from "./helpers.js";

describe("parseTraceparent", () => {
  it("parses a valid sampled traceparent", () => {
    const sc = parseTraceparent(SAMPLE_TRACEPARENT);
    expect(sc).not.toBeNull();
    expect(sc?.traceId).toBe(SAMPLE_TRACE_ID);
    expect(sc?.spanId).toBe(SAMPLE_SPAN_ID);
    expect(sc?.traceFlags).toBe(TraceFlags.SAMPLED);
    expect(sc?.isRemote).toBe(true);
  });

  it("parses an unsampled traceparent (flags 00)", () => {
    const sc = parseTraceparent(`00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-00`);
    expect(sc?.traceFlags).toBe(TraceFlags.NONE);
  });

  it.each([
    ["empty string", ""],
    ["too few segments", `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}`],
    ["too many segments", `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01-extra`],
    ["short trace-id", `00-abc-${SAMPLE_SPAN_ID}-01`],
    ["short span-id", `00-${SAMPLE_TRACE_ID}-abc-01`],
    ["uppercase hex", `00-${SAMPLE_TRACE_ID.toUpperCase()}-${SAMPLE_SPAN_ID}-01`],
    ["non-hex char", `00-zz92f3577b34da6a3ce929d0e0e4736-${SAMPLE_SPAN_ID}-01`],
    ["forbidden version ff", `ff-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`],
    ["all-zero trace-id", `00-${"0".repeat(32)}-${SAMPLE_SPAN_ID}-01`],
    ["all-zero span-id", `00-${SAMPLE_TRACE_ID}-${"0".repeat(16)}-01`],
    ["bad flags length", `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-1`],
  ])("rejects %s", (_label, value) => {
    expect(parseTraceparent(value)).toBeNull();
  });

  it("rejects non-string input", () => {
    // @ts-expect-error deliberately passing a non-string at runtime
    expect(parseTraceparent(undefined)).toBeNull();
    // @ts-expect-error deliberately passing a non-string at runtime
    expect(parseTraceparent(12345)).toBeNull();
  });

  it("masks reserved flag bits down to the sampled bit", () => {
    // flags = 0xff -> only the sampled bit (0x01) should survive.
    const sc = parseTraceparent(`00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-ff`);
    expect(sc?.traceFlags).toBe(TraceFlags.SAMPLED);
  });
});

describe("formatTraceparent", () => {
  it("serializes a span context to a version-00 traceparent", () => {
    const out = formatTraceparent({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    expect(out).toBe(SAMPLE_TRACEPARENT);
  });

  it("emits flags 00 when not sampled", () => {
    const out = formatTraceparent({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.NONE,
    });
    expect(out).toBe(`00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-00`);
  });

  it("returns null for an invalid (all-zero) span context", () => {
    expect(
      formatTraceparent({
        traceId: "0".repeat(32),
        spanId: SAMPLE_SPAN_ID,
        traceFlags: TraceFlags.SAMPLED,
      }),
    ).toBeNull();
  });

  it("round-trips parse -> format -> parse", () => {
    const sc = parseTraceparent(SAMPLE_TRACEPARENT);
    expect(sc).not.toBeNull();
    const str = formatTraceparent(sc!);
    expect(str).toBe(SAMPLE_TRACEPARENT);
    const sc2 = parseTraceparent(str!);
    expect(sc2).toMatchObject({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
  });
});

describe("extractTraceContext", () => {
  it("extracts the correct span context from _meta.traceparent", () => {
    const ctx = extractTraceContext({ [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT });
    const sc = trace.getSpanContext(ctx);
    expect(sc?.traceId).toBe(SAMPLE_TRACE_ID);
    expect(sc?.spanId).toBe(SAMPLE_SPAN_ID);
    expect(sc?.traceFlags).toBe(TraceFlags.SAMPLED);
    expect(sc?.isRemote).toBe(true);
  });

  it("returns a context without span context when _meta is empty", () => {
    expect(trace.getSpanContext(extractTraceContext({}))).toBeUndefined();
  });

  it("returns a context without span context when _meta is undefined", () => {
    expect(trace.getSpanContext(extractTraceContext(undefined))).toBeUndefined();
  });

  it("ignores a non-string traceparent value", () => {
    const ctx = extractTraceContext({
      // numbers are not valid per spec and must be ignored
      [TRACEPARENT_META_KEY]: 123 as unknown as string,
    });
    expect(trace.getSpanContext(ctx)).toBeUndefined();
  });

  it("extracts baggage entries from _meta.baggage", () => {
    const ctx = extractTraceContext({
      [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT,
      [BAGGAGE_META_KEY]: "tenant=acme,region=eu",
    });
    const bag = propagation.getBaggage(ctx);
    expect(bag?.getEntry("tenant")?.value).toBe("acme");
    expect(bag?.getEntry("region")?.value).toBe("eu");
  });
});

describe("injectTraceContext", () => {
  it("writes a traceparent into the _meta object from a given context", () => {
    const base = spanContextToContext({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const meta = injectTraceContext({}, base);
    expect(meta[TRACEPARENT_META_KEY]).toBe(SAMPLE_TRACEPARENT);
  });

  it("creates a _meta object when none is provided", () => {
    const base = spanContextToContext({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const meta = injectTraceContext(undefined, base);
    expect(meta).toBeTypeOf("object");
    expect(meta[TRACEPARENT_META_KEY]).toBe(SAMPLE_TRACEPARENT);
  });

  it("preserves existing non-trace _meta keys", () => {
    const base = spanContextToContext({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const meta = injectTraceContext({ progressToken: "abc" }, base);
    expect(meta.progressToken).toBe("abc");
    expect(meta[TRACEPARENT_META_KEY]).toBe(SAMPLE_TRACEPARENT);
  });

  it("round-trips inject -> extract", () => {
    const base = spanContextToContext({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const meta = injectTraceContext({}, base);
    const sc = trace.getSpanContext(extractTraceContext(meta));
    expect(sc?.traceId).toBe(SAMPLE_TRACE_ID);
    expect(sc?.spanId).toBe(SAMPLE_SPAN_ID);
  });
});

describe("injectTraceContext with baggage", () => {
  it("serializes active baggage into _meta.baggage", () => {
    // Build a context carrying both a span context (for traceparent) and a
    // baggage entry, then assert injectTraceContext writes both keys.
    const withSpan = spanContextToContext({
      traceId: SAMPLE_TRACE_ID,
      spanId: SAMPLE_SPAN_ID,
      traceFlags: TraceFlags.SAMPLED,
    });
    const bag = propagation.createBaggage({ tenant: { value: "acme" } });
    const ctx = propagation.setBaggage(withSpan, bag);

    const meta = injectTraceContext({}, ctx);
    expect(meta[BAGGAGE_META_KEY]).toContain("tenant=acme");
    expect(meta[TRACEPARENT_META_KEY]).toBe(SAMPLE_TRACEPARENT);
  });
});

describe("traceContextFields", () => {
  it("reports the reserved _meta keys it manages", () => {
    const fields = traceContextFields();
    expect(fields).toContain(TRACEPARENT_META_KEY);
    expect(fields).toContain(TRACESTATE_META_KEY);
    expect(fields).toContain(BAGGAGE_META_KEY);
  });
});

afterEach(() => {
  // Disable any globally-registered provider to keep suites isolated within a
  // worker. (These propagation tests register none, but other files do.)
  trace.disable();
});
