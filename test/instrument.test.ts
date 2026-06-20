import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ATTR_MCP_METHOD,
  ATTR_MCP_REQUEST_ID,
  ATTR_MCP_SESSION_ID,
  ATTR_MCP_TOOL_NAME,
  TRACEPARENT_META_KEY,
  instrumentToolHandler,
  runInToolSpan,
} from "../src/index.js";
import {
  SAMPLE_SPAN_ID,
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

describe("runInToolSpan — end to end", () => {
  it("produces a child span parented to the incoming traceparent", async () => {
    const meta = { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT };

    const result = await runInToolSpan(
      meta,
      { toolName: "weather.lookup", requestId: 42, tracer: h.tracer },
      (span) => {
        span.setAttribute("weather.city", "Palma");
        return "sunny";
      },
    );

    expect(result).toBe("sunny");

    const spans = h.spans();
    expect(spans).toHaveLength(1);
    const span = spans[0]!;

    // Same trace as the caller, parented to the caller's span id.
    expect(span.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(SAMPLE_SPAN_ID);

    // SERVER span with the expected attributes.
    expect(span.kind).toBe(SpanKind.SERVER);
    expect(span.name).toBe("tools/call weather.lookup");
    expect(span.attributes[ATTR_MCP_METHOD]).toBe("tools/call");
    expect(span.attributes[ATTR_MCP_TOOL_NAME]).toBe("weather.lookup");
    expect(span.attributes[ATTR_MCP_REQUEST_ID]).toBe("42");
    expect(span.attributes["weather.city"]).toBe("Palma");

    // Ended OK.
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("starts a fresh root trace when no traceparent is present", async () => {
    await runInToolSpan(
      {},
      { toolName: "noparent.tool", tracer: h.tracer },
      () => undefined,
    );
    const span = h.spans()[0]!;
    expect(span.spanContext().traceId).not.toBe(SAMPLE_TRACE_ID);
    // No remote parent.
    expect(span.parentSpanContext).toBeUndefined();
  });

  it("nests child spans under the tool span (one connected tree)", async () => {
    const meta = { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT };

    await runInToolSpan(
      meta,
      { toolName: "outer.tool", tracer: h.tracer },
      async () => {
        // A downstream operation started while the tool span is active.
        await h.tracer.startActiveSpan("downstream.http", async (child) => {
          child.end();
        });
      },
    );

    const spans = h.spans();
    expect(spans).toHaveLength(2);

    const downstream = spans.find((s) => s.name === "downstream.http")!;
    const toolSpan = spans.find((s) => s.name === "tools/call outer.tool")!;

    // Everything shares the caller's trace id.
    expect(toolSpan.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
    expect(downstream.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
    // Downstream is a child of the tool span.
    expect(downstream.parentSpanContext?.spanId).toBe(
      toolSpan.spanContext().spanId,
    );
    // Tool span is a child of the remote caller.
    expect(toolSpan.parentSpanContext?.spanId).toBe(SAMPLE_SPAN_ID);
  });

  it("records the exception and sets ERROR status when the body throws", async () => {
    const meta = { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT };
    const boom = new Error("tool exploded");

    await expect(
      runInToolSpan(meta, { toolName: "bad.tool", tracer: h.tracer }, () => {
        throw boom;
      }),
    ).rejects.toThrow("tool exploded");

    const span = h.spans()[0]!;
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.status.message).toBe("tool exploded");

    // The exception was recorded as a span event.
    const exceptionEvent = span.events.find((e) => e.name === "exception");
    expect(exceptionEvent).toBeDefined();
    expect(exceptionEvent?.attributes?.["exception.message"]).toBe(
      "tool exploded",
    );
  });

  it("attaches a session id when provided", async () => {
    await runInToolSpan(
      { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
      { toolName: "session.tool", sessionId: "sess-123", tracer: h.tracer },
      () => undefined,
    );
    expect(h.spans()[0]!.attributes[ATTR_MCP_SESSION_ID]).toBe("sess-123");
  });

  it("merges custom attributes and a custom method", async () => {
    await runInToolSpan(
      { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT },
      {
        toolName: "x",
        method: "prompts/get",
        attributes: { "gen_ai.system": "anthropic" },
        tracer: h.tracer,
      },
      () => undefined,
    );
    const span = h.spans()[0]!;
    expect(span.name).toBe("prompts/get x");
    expect(span.attributes[ATTR_MCP_METHOD]).toBe("prompts/get");
    expect(span.attributes["gen_ai.system"]).toBe("anthropic");
  });
});

describe("instrumentToolHandler — drop-in wrapper", () => {
  it("wraps a handler and reads _meta from ctx.mcpReq (SDK 1.10+ shape)", async () => {
    const handler = instrumentToolHandler(
      "echo",
      async (args: { msg: string }) => ({
        content: [{ type: "text", text: args.msg }],
      }),
      { tracer: h.tracer },
    );

    const result = await handler(
      { msg: "hi" },
      { mcpReq: { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } }, requestId: 7 },
    );

    expect(result).toEqual({ content: [{ type: "text", text: "hi" }] });

    const span = h.spans()[0]!;
    expect(span.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
    expect(span.parentSpanContext?.spanId).toBe(SAMPLE_SPAN_ID);
    expect(span.attributes[ATTR_MCP_TOOL_NAME]).toBe("echo");
    expect(span.attributes[ATTR_MCP_REQUEST_ID]).toBe("7");
  });

  it("falls back to a flat extra._meta", async () => {
    const handler = instrumentToolHandler("flat", async () => "ok", {
      tracer: h.tracer,
    });
    await handler({}, { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } });
    expect(h.spans()[0]!.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
  });

  it("supports a custom getMeta extractor", async () => {
    const handler = instrumentToolHandler("custom", async () => "ok", {
      tracer: h.tracer,
      getMeta: (extra) =>
        (extra as { request?: { params?: { _meta?: Record<string, unknown> } } })
          .request?.params?._meta,
    });
    await handler(
      {},
      {
        request: { params: { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } } },
      } as never,
    );
    expect(h.spans()[0]!.spanContext().traceId).toBe(SAMPLE_TRACE_ID);
  });

  it("propagates errors and marks the span ERROR", async () => {
    const handler = instrumentToolHandler(
      "boom",
      async () => {
        throw new Error("nope");
      },
      { tracer: h.tracer },
    );
    await expect(
      handler({}, { mcpReq: { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } } }),
    ).rejects.toThrow("nope");
    expect(h.spans()[0]!.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("keeps the active span available to the handler via trace.getActiveSpan", async () => {
    let observedTraceId: string | undefined;
    const handler = instrumentToolHandler(
      "active",
      async () => {
        observedTraceId = trace.getActiveSpan()?.spanContext().traceId;
        return "ok";
      },
      { tracer: h.tracer },
    );
    await handler(
      {},
      { mcpReq: { _meta: { [TRACEPARENT_META_KEY]: SAMPLE_TRACEPARENT } } },
    );
    expect(observedTraceId).toBe(SAMPLE_TRACE_ID);
  });
});
