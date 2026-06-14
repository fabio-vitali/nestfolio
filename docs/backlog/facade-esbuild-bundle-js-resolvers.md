---
id: facade-esbuild-bundle-js-resolvers
status: queued
type: tooling
rank: 1
notes: "esbuild-bundle AppSync JS resolvers so .fn.ts entries can `import` shared TS (single-source domain logic). Today the Facade ships resolvers raw (Code.fromAsset(fnPath), FunctionRuntime.JS_1_0_0 — facade.ts:166) and the APPSYNC_JS runtime forbids import/require, so resolver code can't reuse owned algorithms/helpers (each duplicates or goes Lambda-backed). Add an esbuild step in discoverJsResolvers/Facade that bundles each resolver entry into an APPSYNC_JS-compatible output, re-verifying every existing resolver across all BFFs still synth/deploy/behaves. Reusable platform capability (auth helpers, validation, math sharing). Surfaced 2026-06-14 by the go-live-functional design (D7); go-live P2 updateRiskProfile consumes it to import computeRiskProfile. Needs its own brainstorm/spec (APPSYNC_JS subset constraints, bundle format/target, source-map/debugging, test strategy across all resolvers)."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# esbuild-bundle AppSync JS resolvers (enable shared-code imports)

## Problem

AppSync JS resolvers are shipped **raw**: `Facade`/`discoverJsResolvers` loads each `*.fn.js` via
`Code.fromAsset(fnPath)` with `FunctionRuntime.JS_1_0_0`
(`libs/cdk-constructs/src/core/facade.ts:166`). The `APPSYNC_JS` runtime forbids `import`/`require`, so
a resolver **cannot reuse** shared TypeScript — owned domain algorithms (e.g.
`investor-bff/src/domain/risk-profile.service.ts` `computeRiskProfile`), validation, or auth helpers.
Each resolver must therefore **duplicate** the logic or be promoted to a Lambda-backed resolver.

## Desired

Add an **esbuild bundling step** to the resolver build (in `discoverJsResolvers` / `Facade`) that bundles
each resolver entry (`*.fn.ts`) — inlining its imports — into a single `APPSYNC_JS`-compatible output
that AppSync accepts. Then resolvers can `import { computeRiskProfile } from '../domain/...'` and keep a
**single source of truth**. This is the AWS-recommended pattern for sharing code in APPSYNC_JS resolvers.

## Scope / risks (needs its own brainstorm + spec)

- Bundle **format/target** must stay within the APPSYNC_JS supported subset (no Node builtins, restricted
  globals); pure functions are fine, arbitrary deps are not — define what's allowed.
- **Re-verify every existing resolver** across all BFFs (investor-bff, dashboard-bff, …) still
  synthesizes, deploys, and behaves identically after bundling (unit + integration + scoped e2e).
- Debugging/source-map story for bundled resolvers.
- Test strategy for the bundling step itself (a cdk-constructs construct change).

## Why separate from go-live

Chosen 2026-06-14 (user direction) as a **reusable platform workstream** rather than folded into go-live.
It unblocks go-live **P2** (`updateRiskProfile` importing `computeRiskProfile`); go-live **P1** (the
sim→live switch, which closes the original `go-live-agent-wiring-and-emission` bug) does **not** depend on
it. Sequencing: land this before go-live P2. See
`docs/superpowers/specs/2026-06-14-go-live-functional-design.md` §6.1 (Dependencies) + D7.
