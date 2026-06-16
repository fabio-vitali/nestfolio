---
id: c4-diagrams-stale-across-services
status: shipped
type: tooling
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: |
  Shipped 2026-06-16 (main 9b5f018f). MISDIAGNOSED as stale diagrams — the
  committed diagrams were actually CORRECT. Root cause: tools/generate-c4-sources.mjs
  parsed standalone Lambdas via `new NodejsFunction(...)` only, so after the
  2026-06-15 orphan-cleanup ManagedNodejsFunction migration the parser stopped
  detecting 14 live Lambdas — a regen would DELETE them (42-line, deletion-only
  diff across 16 c3 files), making the diagrams LESS accurate. Fix: regex now
  matches `new (Managed)?NodejsFunction(...)`. Validation: generator unit test
  48/48 (node --test test/tools/generate-c4-sources.test.mjs); full two-stage
  regen now a CLEAN NO-OP (0 c3/0 nestfolio.d2/0 svg diff) with RouteOrderFn +
  FetchTrigger retained. Deferred (not done here): a `check-c4-drift` nx gate
  mirroring check-service-card-drift.mjs to catch future silent drift.
notes: "MISDIAGNOSIS corrected: committed C4 diagrams were correct; the real bug was generate-c4-sources.mjs not detecting ManagedNodejsFunction (post 2026-06-15 orphan-cleanup migration), so a regen would DELETE 14 live Lambdas. Fixed the parser regex (main 9b5f018f); regen is now a clean no-op. Surfaced 2026-06-15 by incident-escalation-path-b."
---

# C4 regen would DELETE live Lambdas — generator could not parse ManagedNodejsFunction

## What actually happened

Filed 2026-06-15 believing the committed C4 diagrams were stale (a regen produced a
42-line, deletion-only diff across 16 `c3/*.d2` files — e.g. `route-order-fn: Lambda
[RouteOrderFn]`, `fetch-trigger: Lambda [FetchTrigger]`). On investigation (2026-06-16,
prompted by "can you simply regenerate?") the opposite was true:

- `RouteOrderFn` (broker-ctrl `service.stack.ts:71`), `FetchTrigger` (fred-adpt `:79`) and
  12 others **still exist in code** — as `ManagedNodejsFunction`.
- `tools/generate-c4-sources.mjs:304` detected standalone Lambdas with a regex matching
  `new NodejsFunction(...)` **only**. The 2026-06-15 orphan-cleanup workstream migrated these
  to `ManagedNodejsFunction`, which the regex missed → the parser dropped the nodes → a regen
  would have DELETED 14 live Lambdas from the diagrams.

So the committed diagrams were the MORE accurate artifact; the generator had a silent parsing
regression.

## Fix (shipped)

- `generate-c4-sources.mjs` regex → `new (?:Managed)?NodejsFunction(...)`.
- Generator unit test 48/48; full regen is now a clean no-op (the diagrams already matched code).

## Deferred follow-up

- A `check-c4-drift` nx gate (mirroring `tools/check-service-card-drift.mjs`) would catch this
  class of silent drift — both real code drift AND generator-parsing gaps — at commit time.
  File separately if/when a C4-freshness gate is wanted.
