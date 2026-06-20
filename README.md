# mcp-otel

W3C Trace Context bridge for the **Model Context Protocol**. It propagates trace context through MCP's `_meta` field and emits OpenTelemetry spans, so a request flowing **Host → MCP server → tool → downstream HTTP** shows up as **one connected trace** in Jaeger, Tempo, Honeycomb, or Datadog.

<!-- badges: replace OWNER once published -->
[![npm](https://img.shields.io/npm/v/mcp-otel.svg)](https://www.npmjs.com/package/mcp-otel)
[![CI](https://github.com/studiomeyer-io/mcp-otel/actions/workflows/ci.yml/badge.svg)](https://github.com/studiomeyer-io/mcp-otel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

---

## Why this exists

The MCP **release candidate of 2026-07-28** nailed down distributed tracing for MCP:

- **SEP-414** reserves the unprefixed `_meta` keys `traceparent`, `tracestate`, and `baggage` for [W3C Trace Context](https://www.w3.org/TR/trace-context/) and [W3C Baggage](https://www.w3.org/TR/baggage/). These keys ride along in `params._meta` of every request, and MCP transports must pass them through untouched.
- **SEP-2577** deprecated MCP's logging capability and pointed at **OpenTelemetry** as the observability path going forward.

Spec post: <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>

So the protocol now says *where* the trace context lives and *which* telemetry system to use — but there was no small library that does the actual plumbing: read the caller's context out of `_meta`, start a correctly-parented OpenTelemetry span for the tool call, and let your downstream calls hang off it. That's all `mcp-otel` is.

It is deliberately thin. It does **not** configure OpenTelemetry for you, ship an exporter, or hide your tracer. You keep full control of sampling, resources, and exporters; `mcp-otel` only bridges `_meta` ↔ spans.

## Install

```bash
npm install mcp-otel @opentelemetry/api
# @modelcontextprotocol/sdk is an optional peer — only needed if you use the
# tool-handler wrapper against the SDK (the low-level helpers don't import it).
```

Peer dependencies:

| Package | Range | Required? |
| --- | --- | --- |
| `@opentelemetry/api` | `^1.9.0` | yes |
| `@modelcontextprotocol/sdk` | `>=1.10.0 <2` | optional (only for `instrumentToolHandler`'s `extra` shape) |

Node **20+**. ESM and CommonJS are both shipped.

## Quickstart — server side

Set OpenTelemetry up once at startup (this is your normal OTel bootstrap — `mcp-otel` doesn't do it for you), then wrap each tool handler.

```ts
import { instrumentToolHandler } from "mcp-otel";
import { z } from "zod";

server.registerTool(
  "weather.lookup",
  { description: "Current weather", inputSchema: { city: z.string() } },
  // The only change: wrap the handler. Same (args, extra) => result signature.
  instrumentToolHandler("weather.lookup", async ({ city }) => {
    // trace.getActiveSpan() here is the MCP server span.
    // Any span you start, or any downstream fetch that injects the active
    // context, nests under it automatically.
    return { content: [{ type: "text", text: `Weather for ${city}` }] };
  }),
);
```

`instrumentToolHandler`:

- reads `traceparent` / `tracestate` / `baggage` from the caller's `_meta`
  (it checks `extra._meta` — the published SDK 1.x shape — and `extra.mcpReq._meta`),
- starts a `SERVER` span named `tools/call <toolName>` as a child of the caller's span,
- runs your handler with that span active (via the OTel context),
- ends the span with `OK` / `ERROR` status and records thrown exceptions.

Attributes set on the span: `mcp.method` (`"tools/call"`), `mcp.tool.name`, `mcp.request.id`, and `mcp.session.id` when available. Pass `attributes` for GenAI conventions like `gen_ai.system`.

Prefer the explicit primitive? Use `runInToolSpan` when you have the `_meta` object directly:

```ts
import { runInToolSpan } from "mcp-otel";

const result = await runInToolSpan(
  meta,                                   // request.params._meta
  { toolName: "weather.lookup", requestId },
  async (span) => {
    span.setAttribute("weather.city", city);
    return doWork(city);
  },
);
```

## Quickstart — client side

If you write an MCP **client**, inject your active trace context into the request `_meta` so the server can continue your trace:

```ts
import { injectTraceContext } from "mcp-otel";

const result = await client.callTool({
  name: "weather.lookup",
  arguments: { city: "Palma" },
  _meta: injectTraceContext({}), // writes traceparent/tracestate/baggage from the active context
});
```

`injectTraceContext(meta, context?)` mutates and returns the `_meta` object, defaulting to the current active OpenTelemetry context. Existing `_meta` keys (like `progressToken`) are preserved.

## Send it to Jaeger

`mcp-otel` emits standard OpenTelemetry spans, so any exporter works. Minimal Jaeger setup:

```bash
docker run -d --name jaeger \
  -p 16686:16686 -p 4318:4318 \
  jaegertracing/all-in-one
```

```ts
// otel-setup.ts — import this once, before anything else.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: "my-mcp-server" }),
  traceExporter: new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }),
});
sdk.start();
```

`NodeSDK` installs the `AsyncLocalStorageContextManager` that lets `mcp-otel` propagate the active span to your downstream calls. Open <http://localhost:16686> and you'll see `host → tools/call <name> → downstream` as one trace.

> **Note on context propagation:** the auto-nesting of downstream spans relies on a context manager being installed — exactly what `NodeSDK` / `NodeTracerProvider.register()` does. In a process with no context manager (e.g. a bare `BasicTracerProvider`), spans are still created and correctly parented to the caller, but `context.active()` inside your handler won't carry the span. This is the standard OpenTelemetry contract, not a quirk of this library.

## Runnable example

A zero-infrastructure example (in-memory exporter, prints the span tree) lives in [`examples/connected-trace.mjs`](./examples/connected-trace.mjs):

```bash
npm run build
node examples/connected-trace.mjs
```

It prints:

```
- host.chat-turn [INTERNAL]
  - tools/call weather.lookup [SERVER]
    - GET /weather [CLIENT]

All 3 spans share one traceId: yes
```

The real-SDK wiring is in [`examples/mcp-server.ts`](./examples/mcp-server.ts).

## API reference

### Instrumentation

- **`instrumentToolHandler(toolName, handler, options?)`** → wrapped handler. Drop-in `(args, extra) => result` wrapper. Options: `method` (default `"tools/call"`), `tracer`, `attributes`, and `getMeta` / `getRequestId` / `getSessionId` extractor overrides.
- **`runInToolSpan(meta, options, body)`** → `Promise<T>`. Low-level primitive: runs `body(span)` inside a `SERVER` span parented to `meta`'s trace context. Options: `toolName`, `method`, `requestId`, `sessionId`, `attributes`, `tracer`.

### Propagation helpers

- **`extractTraceContext(meta, base?)`** → `Context`. Builds an OTel parent context from `_meta` (`traceparent` + `tracestate` + `baggage`). Defaults `base` to `ROOT_CONTEXT` for deterministic behavior.
- **`injectTraceContext(meta, context?)`** → `Meta`. Writes trace keys into `_meta` from `context` (default: active context). Mutates and returns `meta`.
- **`parseTraceparent(s)`** → `SpanContext | null`. Strict W3C parse; returns `null` for malformed, `ff`-version, or all-zero values. Result is `isRemote: true`.
- **`formatTraceparent(spanContext)`** → `string | null`. Serializes to a version-`00` `traceparent`; `null` for an invalid span context.
- **`spanContextToContext(spanContext, base?)`** → `Context`. Wrap a span context you already hold into a context for injection.
- **`traceContextFields()`** → `string[]`. The `_meta` keys this library reads/writes (useful for stripping them before forwarding `_meta`).

### Constants

`TRACEPARENT_META_KEY`, `TRACESTATE_META_KEY`, `BAGGAGE_META_KEY`, `TRACE_META_KEYS`, and the attribute keys `ATTR_MCP_METHOD`, `ATTR_MCP_TOOL_NAME`, `ATTR_MCP_REQUEST_ID`, `ATTR_MCP_SESSION_ID`.

## Why `_meta` and not HTTP headers?

You might ask: MCP can run over Streamable HTTP, so why not just read `traceparent` from the HTTP request headers like a normal web service?

- **MCP is transport-agnostic.** The same server logic runs over stdio, Streamable HTTP, and others. stdio has no headers at all. Putting trace context in `_meta` means propagation works identically on every transport — which is exactly why the spec reserved these keys *in `_meta`* rather than leaning on HTTP.
- **One HTTP connection carries many logical requests.** With Streamable HTTP a single long-lived connection multiplexes many JSON-RPC messages. A transport-level header describes the *connection*, not each tool call. Trace context belongs to the individual request, and in MCP that request is the JSON-RPC message — whose per-message metadata is `_meta`.
- **The host is usually not the HTTP client.** The thing that owns the root span (the LLM host / agent) and the thing that opens the socket can be different processes. `_meta` travels with the logical request across those hops; a hop-by-hop HTTP header does not.

So `_meta` is the only place that is both per-request and transport-independent — which is why SEP-414 standardized on it, and why this library reads/writes there.

## What it does not do

- It does not initialize OpenTelemetry, choose an exporter, or set a sampler — that's your app's job, and keeping it out means no version lock-in on the SDK side.
- It does not auto-instrument the transport or patch the SDK globally; you opt in per tool handler (or call the helpers yourself).
- It does not invent metrics or logs — spans only, per SEP-2577's OTel direction.

## Part of the StudioMeyer MCP toolkit

A small family of focused, production-grade tools for building and operating MCP servers — mix and match:

- [mcp-armor](https://github.com/studiomeyer-io/mcp-armor) — runtime defense sidecar: scans tool calls, verifies signed manifests, blocks known-bad CVEs
- [mcp-gauntlet](https://github.com/studiomeyer-io/mcp-gauntlet) — pre-deploy `mcp-fuzz` (schema-aware fuzzer) + `mcp-storm` (load tester)
- **mcp-otel** *(this one)* — W3C Trace Context → OpenTelemetry bridge
- [mcp-cache-kit](https://github.com/studiomeyer-io/mcp-cache-kit) — leak-safe SEP-2549 caching (`ttlMs` + `cacheScope`)
- [skilldoctor](https://github.com/studiomeyer-io/skilldoctor) — linter + security scanner for agent skill files

## License

MIT © StudioMeyer
