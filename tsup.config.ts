import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // Emit correct CJS interop so the .d.cts isn't a copy of the ESM .d.ts
  // (avoids "types masquerading as ESM" for require() consumers under node16).
  cjsInterop: true,
  minify: false,
  target: "node20",
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
  // Never bundle peers; keep our runtime deps external too so the consumer
  // dedupes a single OpenTelemetry instance.
  external: [
    "@modelcontextprotocol/sdk",
    "@opentelemetry/api",
    "@opentelemetry/core",
    "@opentelemetry/semantic-conventions",
  ],
});
