---
id: integration-suite-lever-5-cdk-bundling
status: parking
type: refactor
notes: "cdk-constructs:test bundles 57 assets in 32s as it synthesizes per-construct stacks in tests. This sits in the unit suite, not integration. Dossier called out as out-of-scope for integration slowness but worth tracking if unit wall-clock becomes a concern."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Lever 5 — CDK bundling tax in unit suite

Out of scope for integration-suite slowness, but tracked per the dossier `docs/backlog/integration-suite-slowness-architecture-levers.md`:

> For completeness: integration tests do NOT bundle Lambdas (no `Bundling asset` lines in the integ log). The bundling tax (104 events in unit log) sits in the unit suite — `cdk-constructs:test` alone bundles 57 assets in 32 s as it synthesizes per-construct stacks in tests.

## When to act

Promote when:
- Unit suite wall-clock becomes a CI bottleneck.
- A new construct lands and bumps the asset count significantly.
- Or someone wants to enable `nx affected -t test --parallel=N` and the bundling overhead dominates.

## Possible directions

- Stub `Bundling` in CDK assertion tests — synth without actually bundling.
- Move bundling out of the construct's `Code` resolution and into a separate, lazily-invoked target.
- Cache bundled assets across test runs.
