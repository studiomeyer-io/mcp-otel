# Security Policy

## Supported versions

`mcp-otel` is pre-1.0. Security fixes land on the latest `0.x` release line.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## Reporting a vulnerability

Please report security issues privately rather than opening a public issue.

- Open a [GitHub security advisory](https://github.com/studiomeyer-io/mcp-otel/security/advisories/new), or
- email **security@studiomeyer.io**.

We aim to acknowledge within 72 hours and to ship a fix or mitigation as fast as the severity warrants. Please give us a reasonable window to release a fix before any public disclosure.

## Scope and threat model

`mcp-otel` is a thin bridge between MCP `_meta` and OpenTelemetry. Things worth knowing:

- **Trace context is attacker-influenced input.** `traceparent` / `tracestate` / `baggage` arrive from the caller. The library validates `traceparent` strictly (length, hex, forbidden `ff` version, all-zero ids) and treats the extracted span context as `isRemote`. It never executes or trusts these values beyond using them as a span parent.
- **Baggage can carry sensitive data.** W3C Baggage is plaintext key/value data that propagates onward. Do not put secrets (tokens, PII) in baggage — anything you inject is forwarded to downstream systems and visible in your tracing backend. Use `traceContextFields()` to strip trace keys from `_meta` before forwarding it somewhere you don't control.
- **Span attributes can leak.** Attributes you add (tool arguments, etc.) are exported to your tracing backend. Avoid recording secrets or PII on spans.
- **No telemetry is sent by this package.** It only emits spans into the OpenTelemetry provider *you* configure. It opens no network connections of its own and has no exporter.

## Dependencies

Runtime dependency is limited to `@opentelemetry/core`; `@opentelemetry/api` and `@modelcontextprotocol/sdk` are peers. We keep dependencies minimal to shrink the supply-chain surface and run `npm audit` in CI.
