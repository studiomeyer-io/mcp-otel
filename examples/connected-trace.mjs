/**
 * Runnable example: one connected trace across Host -> MCP server -> tool -> downstream.
 *
 * It uses an in-memory exporter so you can run it with zero infrastructure:
 *
 *   npm run build           # from the repo root, builds ../dist
 *   node examples/connected-trace.mjs
 *
 * To see the same spans in Jaeger instead, swap the InMemorySpanExporter for an
 * OTLP exporter (see the "Send to Jaeger" section in the README) and start
 * Jaeger with:  docker run -d -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
 */

import { context, trace, SpanKind } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

import {
  injectTraceContext,
  instrumentToolHandler,
} from "../dist/index.js";

// --- 1. Wire up OpenTelemetry (what a real Node app does once at startup) -----
const exporter = new InMemorySpanExporter();
const provider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
const contextManager = new AsyncLocalStorageContextManager().enable();
trace.setGlobalTracerProvider(provider);
context.setGlobalContextManager(contextManager);

const tracer = trace.getTracer("example-app");

// --- 2. The "downstream" work the tool performs (e.g. an HTTP call) ----------
async function callWeatherApi(city) {
  // A normal OTel span. Because the tool handler runs with its span active,
  // this becomes a *child* of the MCP server span automatically.
  return tracer.startActiveSpan(
    "GET /weather",
    { kind: SpanKind.CLIENT, attributes: { "http.request.method": "GET", "url.path": "/weather", "weather.city": city } },
    async (span) => {
      await new Promise((r) => setTimeout(r, 5)); // pretend network latency
      span.end();
      return { city, tempC: 26, sky: "clear" };
    },
  );
}

// --- 3. The MCP tool handler, wrapped by mcp-otel ----------------------------
// In a real server this goes straight into server.registerTool(name, schema, <here>).
const weatherTool = instrumentToolHandler(
  "weather.lookup",
  async ({ city }) => {
    const data = await callWeatherApi(city);
    return { content: [{ type: "text", text: `${data.city}: ${data.tempC}°C, ${data.sky}` }] };
  },
);

// --- 4. Simulate the HOST: start a root span and inject its context into _meta
async function main() {
  await tracer.startActiveSpan("host.chat-turn", async (hostSpan) => {
    hostSpan.setAttribute("gen_ai.system", "anthropic");

    // The host injects its active trace context into the request's _meta. The
    // MCP transport carries these reserved keys untouched (SEP-414).
    const _meta = injectTraceContext({});
    console.log("Host put into _meta:", _meta);

    // The MCP runtime delivers the request to the handler. We emulate the SDK's
    // `extra` argument shape: extra.mcpReq._meta holds the caller's _meta.
    const extra = { mcpReq: { _meta }, requestId: "req-1" };
    const result = await weatherTool({ city: "Palma" }, extra);

    console.log("Tool returned:", JSON.stringify(result));
    hostSpan.end();
  });

  // --- 5. Show the resulting span tree ---------------------------------------
  const spans = exporter.getFinishedSpans();
  const byId = new Map(spans.map((s) => [s.spanContext().spanId, s]));
  const traceId = spans[0]?.spanContext().traceId;

  console.log(`\nOne trace (traceId=${traceId}), ${spans.length} spans:\n`);
  const roots = spans.filter((s) => !s.parentSpanContext || !byId.has(s.parentSpanContext.spanId));
  const printTree = (span, depth) => {
    const indent = "  ".repeat(depth);
    const kind = SpanKind[span.kind];
    console.log(`${indent}- ${span.name} [${kind}] (span=${span.spanContext().spanId})`);
    spans
      .filter((c) => c.parentSpanContext?.spanId === span.spanContext().spanId)
      .forEach((c) => printTree(c, depth + 1));
  };
  roots.forEach((r) => printTree(r, 0));

  const allSameTrace = spans.every((s) => s.spanContext().traceId === traceId);
  console.log(`\nAll ${spans.length} spans share one traceId: ${allSameTrace ? "yes ✅" : "NO ❌"}`);

  await provider.shutdown();
  contextManager.disable();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
