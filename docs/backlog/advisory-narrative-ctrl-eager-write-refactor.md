---
id: advisory-narrative-ctrl-eager-write-refactor
status: parking
type: refactor
notes: "Refactor advisory-narrative-ctrl handler to write AgentInvocation HEAD row eagerly before Memory reads, so integration tests see the row in ~5s instead of ~30-40s."
references:
  - "services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts:47-63"
  - "services/advisory/advisory-narrative-ctrl/src/agent-service.ts:38-47"
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# advisory-narrative-ctrl: eager-write AgentInvocation HEAD row

Refactor the handler so the `AgentInvocation` row appears in DynamoDB within ~1 s of Lambda invocation, instead of after the ~28 s portfolio-engine retry loop + 5 parallel Memory reads. Improves production observability (you can see an in-flight invocation immediately) and lets the integration test tighten its 60 s waitForItem to ~10 s.

## Cheapest path

1. At the top of the handler (`services/advisory/advisory-narrative-ctrl/src/handlers/event-listener.ts`, after operatingMode validation), issue a direct `PutCommand` writing an `AgentInvocation` row with:
   - `pk: DECISION#<decisionId>`
   - `sk: HEAD#<decisionId>` (distinct from the `INV#<eventId>` sk used by `agent-service.ts:46` so the `attribute_not_exists` lock there is preserved)
   - `agentName: 'explainability'`, `status: 'IN_PROGRESS'`, `startedAt`, `ttl`
2. Verify that the egress CDC publisher does NOT emit `EXPLANATION_GENERATED` for `sk` starting with `HEAD#` (only `INV#` and `REASONING#`). If it does, gate the emission.
3. Update `advisory-narrative-ctrl.integration.test.ts:81` from `timeoutMs: 60_000` to `10_000`.
4. Validate: run integration test 3x and an L1 e2e scenario once on deployed dev.

## Risk

- CDC publisher might fan out an unwanted event for the HEAD row — verify before shipping.
- Downstream consumers of `AgentInvocation` rows on the advisory-narrative table (if any beyond decision-workflow-ctrl's AssemblePacket) might see a "phantom" extra row per decision.

## Context

Filed as follow-up from `advisory-narrative-ctrl-tightening-cold-start-flake` (shipped 2026-05-13). See that dossier for full investigation. Competing fix path: `advisory-narrative-ctrl-memory-retry-env-plumb` (CDK-only change, smaller blast radius, but introduces dev/prod behavioral skew).
