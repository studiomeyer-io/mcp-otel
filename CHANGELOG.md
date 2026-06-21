# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `parseTraceparent` now follows the W3C Trace Context forward-compatibility
  rule. A `traceparent` with a *higher* version than `00` (e.g. `01-…`) and
  extra trailing fields is parsed by reading its first four fields and ignoring
  the rest, as long as it is at least 55 characters long. Previously the parser
  hard-required exactly four dash-separated segments and so returned `null` for
  every future-version header — diverging from both the spec and the
  `@opentelemetry/core` propagator that `extractTraceContext` delegates to.
  Version `00` stays length-strict (exactly four fields, no trailing data), and
  `ff`, all-zero trace-id / parent-id, wrong length, and non-hex values are
  still rejected.

### Changed

- Bumped pinned GitHub Actions in CI/publish/scorecard workflows
  (`actions/checkout` v4 → v7, `actions/setup-node` v4 → v6,
  `github/codeql-action/upload-sarif` v3 → v4, `actions/upload-artifact`
  v4 → v7). Supersedes Dependabot #1.

### Tested

- Added forward-compatibility, cross-entry-point agreement
  (`parseTraceparent` vs `extractTraceContext`), malformed-input safety,
  and `tracestate` limit coverage. Test count 48 → 96; line/branch/function
  coverage at 100%.

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
