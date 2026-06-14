---
id: broker-circuit-breaker-heal-singleton-guard
status: queued
type: bug
rank: 2
notes: "broker-alpaca-adpt heal Step Function has NO executionName, so the 'singleton heal' dedup the design claims is absent — concurrent BROKER_CIRCUIT_OPEN events can start parallel heal executions (the conditional breaker-open write limits but does not eliminate). Add an executionName guard; then refresh broker-circuit-breaker.flow.yaml. Surfaced 2026-06-14 by the flows-vs-code audit."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# Heal Step Function lacks the executionName singleton guard

## Evidence

- `services/execution/broker-alpaca-adpt/src/service.stack.ts:134-139` constructs the heal
  `Orchestration` with only `state`, `definitionBody`, `triggers`, `timeout` — **no `executionName`**.
  Step Functions therefore auto-generates a unique name per start; nothing dedupes concurrent heals.
- The flow spec + design narrative claimed an `executionName='heal-alpaca'` singleton; the
  validate-flow audit found it absent and the flow was corrected to state "no singleton guard exists."
- The conditional breaker-open write (`src/repositories/circuit-breaker.repository.ts:28-56`,
  `attribute_not_exists(pk) OR #st <> :open`) limits redundant opens but does not prevent multiple
  `BROKER_CIRCUIT_OPEN` emissions (retries / multiple failing calls) from each starting a heal
  execution.

## Done

1. Add a stable `executionName` (e.g. per-tenant/per-breaker) to the heal `Orchestration` so
   concurrent `BROKER_CIRCUIT_OPEN` events collapse to one in-flight heal (Step Functions rejects a
   duplicate-name start while one is RUNNING). The Orchestration construct already supports
   `executionName` (per the cdk-constructs notes — it also gates `grantStartExecution()`).
2. Refresh `flows/broker-circuit-breaker.flow.yaml` (restore the singleton claim with the real
   mechanism), regenerate `docs/data-flows/`, and re-run `validate-flow broker-circuit-breaker`.
