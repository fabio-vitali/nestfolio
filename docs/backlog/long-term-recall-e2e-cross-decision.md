---
id: long-term-recall-e2e-cross-decision
status: dropped
type: tooling
notes: "Dropped 2026-05-14: blast radius too low to justify the 5-min Bedrock extraction wait + stable-tenant fixture work. The 2026-05-14 synthetic smoke + unit tests + CDK assertions are adequate coverage for a passive enrichment feature that degrades gracefully to 'no historical context'. Revisit if observed agent outputs start misbehaving."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# E2E scenario for cross-decision long-term Memory recall (Phase B follow-up)

## Evidence

The Phase B design spec (`docs/superpowers/specs/2026-05-14-inter-agent-state-handoff-sf-vs-memory-design.md`, § Testing > E2E) prescribed a dedicated scenario:

> Phase B validation gate: new e2e scenario `long-term-recall.e2e.test.ts` — 5 decisions for same tenant, wait ~5 min for extraction backlog, assert `searchLongTermMemory` returns ≥1 record per namespace.

At plan-execution time (2026-05-14), this was deferred because `apps/e2e-feature-tests/src/helpers/fresh-tenant.ts:21-28` rewrites the tenant id with a fresh `e2e-<random>` prefix on every test setup. Running the existing `first-decision.e2e.test.ts` 5 times produces 5 distinct tenants — no cross-decision history accumulates.

A focused synthetic-tenant smoke test was substituted (`CreateEvent → 60s wait → RetrieveMemoryRecords`, captured in the backlog's `validation_gate:`). That validated the Memory → Strategy → Bedrock → Retrieval pipeline end-to-end but did NOT validate the agent-side emit path on a real decision, nor the cross-decision retrieval shape.

## Hypothesis

Cheapest next step: extend `fresh-tenant.ts` (or add a sibling helper) to support a STABLE_TENANT_ID env-var override. With a stable tenant:

1. Pre-create the tenant once.
2. Run the existing first-decision scenario 5 times against the same tenant.
3. Wait 5 minutes (Bedrock extraction lag).
4. Assert (via the BFF or a direct `searchLongTermMemory` SDK call from the test): each of the 4 strategy namespaces returns ≥1 extracted record.

Alternative: write the new scenario as a Node script under `apps/e2e-feature-tests/scripts/` rather than a Jest test, so the 5-minute wait doesn't pollute the standard suite.

## Why queued

Required to make `apps/e2e-feature-tests` truly green for the Phase B contract. Without this scenario, the e2e suite has no automated proof that cross-decision recall works — only a one-shot synthetic smoke test that fired on the ship day and isn't re-run by CI. Sized below `revoke-mandate-e2e-timeout-flake` (rank 9, breaks an existing scenario) and above `advisory-narrative-agentcore-latency-residual` (rank 20, blocks the gen_ai latency assertion).

## Related

- [[inter-agent-state-handoff-sf-vs-memory]] (shipped 2026-05-14) — Phase B's substituted smoke test referenced this gap.
- [[advisory-phase-ab-integration-coverage]] — sibling gap at the integration layer.
