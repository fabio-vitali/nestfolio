---
id: typecheck-diagnostics-masking
status: parking
type: epic
notes: "ts-jest diagnostics:false + esbuild bundling (or no typecheck target at all) means a real tsc --noEmit never gates, so latent type errors / contract drift hide until runtime. Theme epic, 4 members."
done_when: "Each in-scope project's latent tsc errors are cleared AND a tsc --noEmit typecheck target gates them in the nx pipeline so diagnostics:false (or a missing target) can no longer mask them; all members shipped or dropped."
scope: "Type errors / contract drift that `tsc --noEmit` would report but the nx pipeline never gates — either because the `test` target masks them (ts-jest diagnostics:false + esbuild, never tsc) or because the project has no typecheck target at all (the two e2e apps)."
out_of_scope:
  - "event-processor library type-design gaps (event-processor-api-hardening) — loose lib types are a different root cause than a masked-error gating gap"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Typecheck gating — diagnostics:false masks tsc errors

Root cause: ts-jest runs with `diagnostics: false` (+ esbuild bundling, not tsc), so `tsc --noEmit` type errors never fail unit/integration tests or the nx pipeline — and where a project has no typecheck target at all (the two e2e apps), a shared-contract rename that breaks an e2e *spec* slips through to the expensive E6 run. The compile-time safety the typed-subject / typed-test-fixtures programs promise is partially undermined. Fix pattern: clear each project's latent errors, then add a `typecheck` (tsc --noEmit) target to the nx pipeline (some services already have one for read-model type-tests — extend it; the e2e apps need one created).

Members (derived from `epic:` pointers):
- `broker-alpaca-adpt-latent-tsc-errors` (1 service)
- `investor-services-latent-tsc-errors` (the wider investor/advisory/execution surface)
- `dwc-snapshot-projector-drop-skip` (TS2769; nothing in the nx pipeline compiles src/handlers)
- `e2e-apps-typecheck-target` (the two e2e apps have no typecheck target at all)
