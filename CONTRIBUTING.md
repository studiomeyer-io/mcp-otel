# Contributing to mcp-otel

Thanks for considering a contribution. `mcp-otel` is deliberately **thin**: it
bridges MCP `_meta` ↔ OpenTelemetry spans and nothing else. The bar for new code
is "it makes the bridge more correct or more spec-compliant, and it ships with a
test".

## Quick Start

```sh
git clone https://github.com/studiomeyer-io/mcp-otel
cd mcp-otel
npm ci
npm run typecheck      # tsc --noEmit, strict
npm run build          # tsup, dual ESM + CJS
npm test               # vitest (asserts real parent/child span linkage)
node examples/connected-trace.mjs   # zero-infra span-tree smoke test
```

Node **20+**. CI runs the suite on Node 20 and 22 — your patch needs to pass on
both.

## What we accept

- **Spec-correctness fixes.** If our `traceparent` parsing, `_meta` extraction, or
  span parenting diverges from [W3C Trace Context](https://www.w3.org/TR/trace-context/)
  or MCP **SEP-414**, that's a bug — open a PR with a failing test.
- **SDK-shape coverage.** The published `@modelcontextprotocol/sdk` exposes `_meta`
  flat as `extra._meta`; the 2.0-alpha shape is `extra.mcpReq._meta`. New real-world
  SDK shapes are welcome, each with a test asserting extraction.
- **Docs.** Typo fixes, clarifications, ecosystem links.

## What we are slow on

- **New runtime dependencies.** The only runtime dep is `@opentelemetry/core`;
  `@opentelemetry/api` and the MCP SDK are *peers*. Adding a bundled dependency
  changes that contract — open an issue to discuss first.
- **Bootstrapping OpenTelemetry for the user** (exporters, samplers, providers).
  That is intentionally out of scope — keeping it out is what avoids SDK version
  lock-in. We will decline these.
- **Metrics or logs.** Spans only, per SEP-2577. Not a gap, a design choice.

## Pull Request Process

1. Open an issue or draft PR first for anything non-trivial.
2. One logical change per PR. Easier to review, easier to revert.
3. CI must be green: `typecheck`, `build`, `test`, and the example smoke step.
4. Add a `CHANGELOG.md` entry under `[Unreleased]` describing the user-visible
   change in plain English.
5. For security-impacting changes, see [SECURITY.md](SECURITY.md) — please email
   instead of opening a public issue.

## Coding Standards

- TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`). No `any` in shipped code.
- Keep the public surface small and documented. New exports need a README entry.
- Dual ESM/CJS correctness is enforced — keep `are-the-types-wrong` at 4/4.
- No side effects at import time (`"sideEffects": false`).

## Testing

- Tests live in `test/` and use vitest with an `InMemorySpanExporter` so they
  assert *real* parent-child linkage via `_meta`, not mocks.
- New behavior needs a test that fails on `main` and passes with your patch.

## Releasing (maintainers)

- Bump `version` in `package.json` and add a dated section to `CHANGELOG.md`.
- Tag `vX.Y.Z` on `main`. `publish.yml` runs `npm publish --provenance` via OIDC
  (needs the `NPM_TOKEN` repo secret).
- Verify on npm and with a clean `npm pack` inspection (dist + meta only).

## License

By contributing, you agree your work is licensed under the [MIT License](LICENSE).

## Code of Conduct

Be kind. Assume good faith. We are a small studio in Palma de Mallorca — no drama,
disagreement is fine, contempt is not.
