---
id: typecheck-diagnostics-masking
status: parking
type: epic
notes: "ts-jest diagnostics:false + esbuild bundling means a real tsc --noEmit never gates, so per-service latent type errors hide until runtime. Theme epic, 3 members."
done_when: "Each in-scope service's latent tsc errors are cleared AND a tsc --noEmit typecheck target gates them in the nx pipeline so diagnostics:false can no longer mask them; all members shipped or dropped."
scope: "Pre-existing type errors that `tsc --noEmit` reports but the `test` target masks (ts-jest diagnostics:false + esbuild, never tsc), and the missing per-service typecheck gate."
out_of_scope:
  - "event-processor library type-design gaps (event-processor-api-hardening) — loose lib types are a different root cause than a masked-error gating gap"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typecheck gating — diagnostics:false masks tsc errors

Root cause: ts-jest runs with `diagnostics: false` (+ esbuild bundling, not tsc), so `tsc --noEmit` type errors never fail unit/integration tests or the nx pipeline. The compile-time safety the typed-subject / typed-test-fixtures programs promise is partially undermined for these services. Fix pattern: clear each service's latent errors, then add a `typecheck` (tsc --noEmit) target to the nx pipeline (some services already have one for read-model type-tests — extend it).

Members (derived from `epic:` pointers):
- `broker-alpaca-adpt-latent-tsc-errors` (1 service)
- `investor-services-latent-tsc-errors` (the wider investor/advisory/execution surface)
- `dwc-snapshot-projector-drop-skip` (TS2769; nothing in the nx pipeline compiles src/handlers)
