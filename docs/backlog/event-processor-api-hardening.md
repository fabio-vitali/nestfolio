---
id: event-processor-api-hardening
status: parking
type: epic
notes: "event-processor public types/APIs are loose — stringly-typed IntentResult._tag + a silent event-id idempotency default — causing downstream narrowing loss and at-least-once misuse. Theme epic, 3 members."
done_when: "event-processor's IntentResult is a discriminated union (handler returns narrow), the idempotency choice is explicit at the call site, and the advisory handler return-type narrowing debt it causes is cleared; all members shipped or dropped."
scope: "Loose type/API design in the event-processor library that invites bugs: non-discriminated IntentResult, implicit idempotency default, and the handler return-type narrowing it costs downstream."
out_of_scope:
  - "Plain latent tsc errors masked by diagnostics:false (typecheck-diagnostics-masking) — a test-config gating gap, not lib type design"
references: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# event-processor API hardening

Root cause: the event-processor library's public contracts are loose. `IntentResult._tag` is `string` (not a discriminated union like WriteIntent), so executor returns lose downstream narrowing — which shows up as 'intents missing on inferred handler return types' + materializeToTable overload mismatches across the advisory services. And `record()` defaults to event-id-scoped idempotency silently, a common source of at-least-once bugs. Fix pattern: make IntentResult a discriminated union, add an explicit idempotency-choice API, then clear the advisory narrowing debt the union change enables.

Members (derived from `epic:` pointers):
- `event-processor-intent-result-discriminated-union`
- `event-processor-explicit-idempotency-api`
- `advisory-handler-type-narrowing-debt` (downstream of the discriminated-union gap; clearing it depends on that change)
