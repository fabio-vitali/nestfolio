---
id: assemble-packet-narrative-explainability-key-mismatch
status: queued
rank: 4
type: bug
notes: "AssemblePacket reads narrative.explainability.rationale but advisory-narrative-ctrl returns narrative with rationale spread at top level — placeholder fires on every successful decision. Surfaced 2026-05-24 by Bug B during the silent-dedup workstream."
references:
  - path: services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts
    anchor: L83-L87
  - path: services/advisory/advisory-narrative-ctrl/src/agent-service.ts
    anchor: L143
out_of_scope: []
spec: null
plan: null
topic_memory: []
validation_gate: null
---

# AssemblePacket reads wrong key path for narrative rationale

AssemblePacket falls through to the "Decision pending — the advisory narrative for this DEPOSIT_DETECTED trigger has not been persisted yet." placeholder on every decision because the path it reads doesn't exist.

`services/advisory/decision-workflow-ctrl/src/handlers/assemble-packet.ts:83-87`:

```ts
const explainability = (narrative?.explainability as Record<string, unknown> | undefined) ?? {};
const explanation =
  (explainability.rationale as string | undefined) ??
  (explainability.summary as string | undefined) ??
  `Decision pending — the advisory narrative for this ${trigger} trigger has not been persisted yet.`;
```

But `services/advisory/advisory-narrative-ctrl/src/agent-service.ts:143` returns:

```ts
return { decisionId, ...explainability, metadata: { durationMs, modelTier: 'haiku' } };
```

`explainability` is spread at the top level — so the SF state carries `narrative.rationale` and `narrative.summary` directly, NOT under `narrative.explainability.*`.

## Fix

Change `assemble-packet.ts:84-87` to read `narrative.rationale ?? narrative.summary ?? <placeholder>` (drop the `.explainability.` segment). Add a regression unit test that asserts the full rationale lands on the DecisionPacket row when `narrative` is the realistic shape.

## Why it's been hidden

The Playwright `new-investor-happy-path` test asserts `rationale.length > 10` at Step 9 — the placeholder is itself > 10 chars, so the test passes Step 9 even with the bug. But the user-facing rationale is degraded on every decision.

## Related

- Parent workstream: `new-investor-happy-path-pending-at-decision-confirm`
- Spec context (where Bug B was first documented as out_of_scope): `docs/superpowers/specs/2026-05-24-event-processor-update-or-retry-design.md`
