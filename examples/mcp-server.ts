/**
 * How mcp-otel slots into a real `@modelcontextprotocol/sdk` server.
 *
 * This file is type-checked against the SDK but is not meant to be run as-is
 * (it has no transport.listen()/connect wiring). It shows the one line that
 * matters: wrap your tool handler with `instrumentToolHandler`.
 *
 * Do your OpenTelemetry setup once at process start (NodeSDK / NodeTracerProvider
 * with an OTLP exporter). mcp-otel does NOT configure OTel for you — it only
 * bridges MCP `_meta` <-> OTel spans, so you keep full control of sampling,
 * exporters and resource attributes.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { instrumentToolHandler } from "mcp-otel";

const server = new McpServer({
  name: "weather-server",
  version: "1.0.0",
});

server.registerTool(
  "weather.lookup",
  {
    description: "Look up the current weather for a city.",
    inputSchema: { city: z.string() },
  },
  // The ONLY change: wrap the handler. The returned function has the same
  // (args, extra) => result signature the SDK expects. mcp-otel reads the
  // caller's traceparent from `extra._meta`, starts a SERVER span as its child,
  // and any span you start inside (or any downstream HTTP that injects the
  // active context) nests under it automatically.
  instrumentToolHandler("weather.lookup", async ({ city }) => {
    // ...your real logic. `trace.getActiveSpan()` here is the MCP server span.
    return {
      content: [{ type: "text", text: `Weather for ${city}: sunny, 26C` }],
    };
  }),
);

// Connect a transport as usual, e.g.:
//   const transport = new StdioServerTransport();
//   await server.connect(transport);

export { server };
