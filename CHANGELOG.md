# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-20

Initial release.

### Added

- `instrumentToolHandler(toolName, handler, options?)` — drop-in
  `(args, extra) => result` wrapper that reads W3C Trace Context from the caller's
  `_meta` (MCP **SEP-414**), starts a correctly-parented `SERVER` span named
  `tools/call <toolName>`, runs the handler with that span active, and ends it with
  `OK` / `ERROR` status (recording thrown exceptions). Checks both `extra._meta`
  (published SDK 1.x shape) and `extra.mcpReq._meta` (2.0-alpha shape).
- `runInToolSpan(meta, options, body)` — low-level primitive for when you hold the
  `_meta` object directly.
- Propagation helpers: `extractTraceContext`, `injectTraceContext`,
  `parseTraceparent`, `formatTraceparent`, `spanContextToContext`,
  `traceContextFields`.
- `mcp.*` span attributes (`method`, `tool.name`, `request.id`, `session.id`) plus
  opt-in `gen_ai.*` / custom attributes via `options.attributes`.
- Dual ESM + CJS build with `.d.ts` / `.d.cts`, verified with
  `are-the-types-wrong` (4/4).
- `@opentelemetry/api` + `@modelcontextprotocol/sdk` as peer dependencies (SDK
  optional); only runtime dependency is `@opentelemetry/core`.

### Notes

- Does not bootstrap OpenTelemetry, ship an exporter, or invent metrics/logs —
  spans only, per SEP-2577's OTel direction. You keep full control of sampling and
  exporters.
- Auto-nesting of downstream spans requires a registered context manager (what
  `NodeSDK` / `NodeTracerProvider.register()` installs) — the standard OTel
  contract, documented in the README.

[Unreleased]: https://github.com/studiomeyer-io/mcp-otel/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/studiomeyer-io/mcp-otel/releases/tag/v0.1.0
