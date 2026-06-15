---
id: broker-circuit-breaker-heal-singleton-guard
status: active
type: bug
rank: 2
notes: "Heal-workflow dedup. Investigation 2026-06-15 found the filed fix ('add executionName') unimplementable as written: Orchestration's executionName DISABLES the EB trigger (programmatic StartExecution only) AND a static name hits the SF 90-day name-reuse limit (one heal per 90 days). User chose (2026-06-15) the IDEMPOTENT-HEAL approach over a singleton lock: rewrite CircuitBreakerHealDefinition so the heal is idempotent (entry Choice on the correct GLOBAL breaker row -> Succeed-noop if not OPEN; conditional CloseBreaker UpdateItem on state=OPEN so only the OPEN->CLOSED transition emits BROKER_CIRCUIT_CLOSED). Concurrent/redelivered heals become harmless no-ops. FOLDS IN a separate latent bug found in the same construct: CloseBreaker keys CircuitBreaker#alpaca#<tenantId> (per-tenant) but the repo opens/reads the GLOBAL CircuitBreaker#alpaca, so heals never actually closed the gated row. Then refresh broker-circuit-breaker.flow.yaml + regenerate docs/data-flows + validate-flow. Surfaced 2026-06-14 by the flows-vs-code audit."
references: []
out_of_scope:
  - "Singleton execution-lock approach (per-episode dynamic name + trigger Lambda + Orchestration construct-API change) — explicitly rejected in favor of idempotency."
  - "investor-ctrl / investor-bff circuit-event consumers — already idempotent (record() event-id-keyed); covered by the emit-once rewrite."
  - "The Orchestration construct's executionName API + the order/transfer polling Orchestrations — heal stays EB-triggered with auto-generated names."
  - "broker-sim circuit-breaker path — this fix is the broker-alpaca-adpt heal construct."
  - "New e2e scenarios for the circuit-breaker flow — validation is via synthetic SF execution + existing integration/unit coverage."
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Heal Step Function: make the heal idempotent (and fix the wrong-row close)

## Chosen approach (2026-06-15)

The originally-filed fix ("add an `executionName` singleton guard") is **not implementable as
written**, and a singleton lock is not the cleanest fit for this codebase. User selected the
**idempotent-heal** approach instead. Rationale (reuse-first, per CLAUDE.md):

- `Orchestration`'s `executionName` is a *mode switch* — setting it **disables the EventBridge
  trigger rules** (`libs/cdk-constructs/src/core/orchestration.ts:85-129`); the SF would then only
  start via programmatic `StartExecution`. So the heal would never auto-start on
  `BROKER_CIRCUIT_OPEN`.
- A **static** execution name hits the STANDARD-workflow **90-day name-reuse limit**
  (`ExecutionAlreadyExists`) → the breaker could heal only once per 90 days. A correct singleton
  needs a per-episode dynamic name (e.g. `heal-alpaca-${openedAt}`), which the construct's
  synth-time static `executionName` can't express → would require a new trigger Lambda + a
  construct-API change.
- Even a perfect singleton can't stop EventBridge (at-least-once) from delivering the resulting
  `BROKER_CIRCUIT_CLOSED` twice downstream — so idempotent emission/consumption is required anyway.
  Making the **shared** `CircuitBreakerHealDefinition` idempotent-by-construction is the more
  reusable, codebase-idiomatic fix (Choice-on-state over locks; cf. resilience/idempotency suites).

## Evidence

- `services/execution/broker-alpaca-adpt/src/service.stack.ts:133-138` constructs the heal
  `Orchestration` with only `state`, `definitionBody`, `triggers`, `timeout` — no `executionName`
  (so SF auto-generates a unique name per start; nothing dedupes concurrent/redelivered heals).
- `circuit-breaker.repository.ts:28-56` `open()` is a conditional write
  (`attribute_not_exists(pk) OR #st <> :open`) and `event-listener.ts:29-32` only emits
  `BROKER_CIRCUIT_OPEN` when `opened===true`. So the real duplicate vector is **CDC at-least-once
  redelivery** of the single `NormalizedEvent` row, not "many failing calls."
- **Wrong-row bug (folded in):** `libs/cdk-constructs/src/core/circuit-breaker-heal.ts:127`
  `CloseBreaker` keys `pk = States.Format('${breakerKey}#{}', $.tenantId)` =
  `CircuitBreaker#alpaca#<tenantId>` (per-tenant), but the repo opens/reads the **global**
  `CircuitBreaker#alpaca` (sk `CircuitBreaker`). The heal updates a phantom per-tenant row and never
  clears the row `isOpen('alpaca')` gates on → breaker stays OPEN after a "successful" heal while
  `BROKER_CIRCUIT_CLOSED` still fires.

## Done

1. Rewrite `libs/cdk-constructs/src/core/circuit-breaker-heal.ts` to be idempotent:
   - Entry step GetItems the **correct global** breaker row; a Choice short-circuits to `Succeed`
     when state is not `OPEN` (redelivered/late heal → no-op).
   - `CloseBreaker` becomes a **conditional** `UpdateItem` (`condition: state = OPEN`) on the
     **global** `CircuitBreaker#alpaca` key (drop the `#<tenantId>` suffix); on the
     condition-failed branch, skip `EmitBreakerClosed` (another heal already closed it) and `Succeed`
     — so only the OPEN→CLOSED transition emits `BROKER_CIRCUIT_CLOSED`.
   - Keep escalation path; ensure it cannot double-emit.
2. Verify the global-key change against `circuit-breaker.repository.ts` (open/isOpen/close all use
   `CircuitBreaker#alpaca` / sk `CircuitBreaker`) and `broker-alpaca-adpt/src/service.stack.ts`
   wiring; add/adjust unit coverage (CDK assertions + any heal-definition tests).
3. Refresh `flows/broker-circuit-breaker.flow.yaml` (replace the "no singleton guard" narrative with
   the idempotent-heal mechanism + the corrected global close), regenerate `docs/data-flows/`, and
   re-run `validate-flow broker-circuit-breaker`.
4. Deploy `broker-alpaca-adpt` to dev; validate the heal closes the **global** row via a synthetic
   SF execution (e2e-green ≠ guard fired — see States.Runtime-uncatchable lesson).

## Out of scope

- The singleton execution-lock approach (per-episode dynamic name + trigger Lambda + Orchestration
  construct-API change) — explicitly rejected in favor of idempotency.
- Changes to `investor-ctrl` / `investor-bff` circuit-event consumers: investor-ctrl notifications
  are already `record()` event-id-keyed (`Notification#SYSTEM#${eventId}`), so the emit-once
  rewrite fully covers them.
- The `Orchestration` construct's `executionName` API and the order/transfer polling
  Orchestrations — untouched; the heal stays EB-triggered with auto-generated names.
- The broker-sim circuit-breaker path (this fix is the `broker-alpaca-adpt` heal construct).
- New e2e *scenarios* for the circuit-breaker flow — validation is via synthetic SF execution +
  existing integration/unit coverage.
