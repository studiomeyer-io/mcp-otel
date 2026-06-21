import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATTR_MCP_REQUEST_ID,
  ATTR_MCP_SESSION_ID,
  ATTR_MCP_TOOL_NAME,
  TRACEPARENT_META_KEY,
  instrumentToolHandler,
  runInToolSpan,
} from "../src/index.js";
import {
  SAMPLE_TRACEPARENT,
  SAMPLE_TRACE_ID,
  type TraceTestHarness,
  createHarness,
} from "./helpers.js";

let h: TraceTestHarness;

beforeEach(() => {
  h = createHarness();
});

afterEach(async () => {
  await h.reset();
});

/**
 * The whole point of being a tracing *bridge* is that it must never make the
 * thing it instruments worse. A malformed inbound `traceparent` must downgrade
 * to a fresh root trace — silently — not throw and not produce a span wrongly
 * parented to garbage.
 */
describe("runInToolSpan — malformed inbound trace context", () => {
  it.each([
    ["garbage", "not-a-traceparent"],
    ["forbidden version", `ff-${SAMPLE_TRACE_ID}-00f067aa0ba902b7-01`],
    ["all-zero trace-id", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`],
    ["truncated", "00-deadbeef"],
    ["empty string", ""],
  ])(
    "starts a fresh root span (no remote parent) for %s",
    async (_label, badTp) => {
      const out = await runInToolSpan(
        { [TRACEPARENT_META_KEY]: badTp },
        { toolName: "resilient.tool", tracer: h.tracer },
        () => "ok",
      );
      expect(out).toBe("ok");

      const span = h.spans()[0]!;
      // Fresh root: not parented to anything, and a brand-new trace id.
      expect(span.parentSpanContext).toBeUndefined();
      expect(span.spanContext().traceId).not.toBe(SAMPLE_TRACE_ID);
      expect(span.kind).toBe(SpanKind.SERVER);
      expect(span.status.code).toBe(SpanStatusCode.OK);
    },
  );

  it("does not throw when _meta itself is undefined", async () => {
    await expect(
      runInToolSpan(undefined, { toolName: "no.meta", tracer: h.tracer }, () =>
        undefined,
      ),
    ).resolves.toBeUndefined();
    expect(h.spans()[0]!.parentSpanContext).toBeUndefined();
  });
});

/**
 * `runInToolSpan` is also valid without a `toolName` (e.g. instrumenting a
 * `notifications/*` method that has no tool). The span name is then just the
 * method, and no `mcp.tool.name` attribute is set.
 */
describe("runInToolSpan — without a toolName", () => {
  it("names the span after the method and omits mcp.tool.name", async () => {
    await runInToolSpan(
      { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
      { method: "notifications/progress", tracer: h.tracer },
      () => undefined,
    );
    const span = h.spans()[0]!;
    expect(span.name).toBe("notifications/progress");
    expect(span.attributes[ATTR_MCP_TOOL_NAME]).toBeUndefined();
  });

  it("defaults the span name to tools/call when neither method nor toolName is given", async () => {
    await runInToolSpan(
      { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
      { tracer: h.tracer },
      () => undefined,
    );
    expect(h.spans()[0]!.name).toBe("tools/call");
  });
});

/**
 * Branch coverage + behavioural locks for the optional-field plumbing in
 * `instrumentToolHandler`: requestId / sessionId are only set on the span when
 * the handler's `extra` actually provides them (exactOptionalPropertyTypes-safe
 * conditional spreads), and a numeric requestId is stringified.
 */
describe("instrumentToolHandler — optional field plumbing", () => {
  it("omits request/session attributes when extra provides none", async () => {
    const handler = instrumentToolHandler("bare", async () => "ok", {
      tracer: h.tracer,
    });
    await handler({}, { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } });

    const span = h.spans()[0]!;
    expect(span.attributes[ATTR_MCP_TOOL_NAME]).toBe("bare");
    expect(span.attributes[ATTR_MCP_REQUEST_ID]).toBeUndefined();
    expect(span.attributes[ATTR_MCP_SESSION_ID]).toBeUndefined();
  });

  it("propagates a session id pulled from extra", async () => {
    const handler = instrumentToolHandler("sess", async () => "ok", {
      tracer: h.tracer,
    });
    await handler(
      {},
      {
        _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
        sessionId: "sess-xyz",
      },
    );
    expect(h.spans()[0]!.attributes[ATTR_MCP_SESSION_ID]).toBe("sess-xyz");
  });

  it("stringifies a numeric request id from extra", async () => {
    const handler = instrumentToolHandler("rid", async () => "ok", {
      tracer: h.tracer,
    });
    await handler(
      {},
      { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT }, requestId: 99 },
    );
    expect(h.spans()[0]!.attributes[ATTR_MCP_REQUEST_ID]).toBe("99");
  });

  it("honours custom getRequestId / getSessionId extractors", async () => {
    const handler = instrumentToolHandler("custom-ids", async () => "ok", {
      tracer: h.tracer,
      getRequestId: (extra) =>
        (extra as { rid?: string }).rid,
      getSessionId: (extra) =>
        (extra as { sid?: string }).sid,
    });
    await handler(
      {},
      {
        _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
        rid: "from-getter",
        sid: "sess-getter",
      } as never,
    );
    const span = h.spans()[0]!;
    expect(span.attributes[ATTR_MCP_REQUEST_ID]).toBe("from-getter");
    expect(span.attributes[ATTR_MCP_SESSION_ID]).toBe("sess-getter");
  });

  it("merges handler-level default attributes onto each span", async () => {
    const handler = instrumentToolHandler("attrd", async () => "ok", {
      tracer: h.tracer,
      attributes: { "gen_ai.system": "anthropic" },
    });
    await handler({}, { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } });
    expect(h.spans()[0]!.attributes["gen_ai.system"]).toBe("anthropic");
  });

  it("uses the default global tracer when none is supplied", async () => {
    // No `tracer` option -> resolveTracer falls back to
    // trace.getTracer("mcp-otel"), which the harness registered globally.
    const handler = instrumentToolHandler("default-tracer", async () => "ok");
    await handler({}, { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } });
    expect(h.spans()).toHaveLength(1);
    expect(h.spans()[0]!.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
  });
});
