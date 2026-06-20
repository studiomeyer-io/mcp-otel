import { type Tracer, context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

export interface TraceTestHarness {
  exporter: InMemorySpanExporter;
  provider: BasicTracerProvider;
  tracer: Tracer;
  /** Spans that have ended so far, in finish order. */
  spans(): ReadableSpan[];
  /** Reset for the next test and unregister the global provider + context manager. */
  reset(): Promise<void>;
}

/**
 * Spin up an in-memory OpenTelemetry tracer pipeline for assertions.
 *
 * Registers both a tracer provider (so `trace.getTracer(...)` inside the library
 * resolves here) and an `AsyncLocalStorageContextManager` — the same context
 * manager a real Node app installs via `NodeSDK` / `NodeTracerProvider.register()`.
 * Without it, `context.with()` cannot propagate the active span, so child spans
 * would not nest. `SimpleSpanProcessor` exports synchronously on `span.end()`,
 * so finished spans are visible immediately without flushing.
 */
export function createHarness(name = "mcp-otel-test"): TraceTestHarness {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  const contextManager = new AsyncLocalStorageContextManager();
  contextManager.enable();

  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(contextManager);

  const tracer = trace.getTracer(name);

  return {
    exporter,
    provider,
    tracer,
    spans: () => exporter.getFinishedSpans(),
    async reset() {
      exporter.reset();
      contextManager.disable();
      await provider.shutdown();
      context.disable();
      trace.disable();
    },
  };
}

/** A valid, well-known W3C traceparent (from the spec examples). */
export const SAMPLE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
export const SAMPLE_SPAN_ID = "00f067aa0ba902b7";
export const SAMPLE_TRACEPARENT = `00-${SAMPLE_TRACE_ID}-${SAMPLE_SPAN_ID}-01`;
