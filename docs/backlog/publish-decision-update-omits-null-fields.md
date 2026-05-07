---
id: publish-decision-update-omits-null-fields
status: shipped
rank: null
type: bug
references: []
out_of_scope:
  - "Switching the MFE store to merge-instead-of-replace (orthogonal — current full-replace semantics are intentional, the bug is that the broadcaster doesn't carry full state)."
  - "Cleaning up the IAM-broadcaster's hardcoded `trigger: 'BROADCAST'` fallback (separate small backlog item if it surfaces)."
  - "Backfill / replay of historical broadcast frames — purely a forward fix."
spec: null
plan: null
topic_memory: []
validation_gate: "pnpm nx run advisory-bff:test → 28/28 pass (incl. new propagation test); pnpm nx run advisory-bff:lint → clean"
notes: "Shipped 2026-05-07 — broadcaster + resolver now carry confirmedAt/rejectedAt/rejectionReason/confirmationRequired."
---

# `publishDecisionUpdate` omits decision-detail null fields

`PUBLISH_DECISION_UPDATE` in `services/advisory/advisory-bff/src/handlers/decision-publisher.ts` sets only {decisionId, tenantId, status, trigger, explanation, proposedTrades, version, createdAt, updatedAt}. `confirmedAt`/`rejectedAt`/`rejectionReason`/`confirmationRequired` arrive as null at decision-detail's `onDecisionUpdate` handler, which calls `store.setDecision(updated)` (replace, not merge — `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:380`). Latent: any IAM-published mid-cycle frame would erase those fields. Currently masked because `confirmDecision`/`rejectDecision` re-broadcast via DDB readback. Surfaced 2026-05-02 during decision-list Pattern B workstream.

## Shipped 2026-05-07

1. **Schema** (`services/advisory/advisory-bff/src/schema.graphql`): added 4 nullable args to `publishDecisionUpdate(...)` — `confirmationRequired: Boolean`, `confirmedAt: String`, `rejectedAt: String`, `rejectionReason: String`.
2. **Resolver** (`src/graphql/js-function/publish-decision-update.fn.js`): echo from args with `confirmationRequired ?? false` fallback. Also fixed two pre-existing inconsistencies (now echoes `args.trigger` instead of hardcoded `'BROADCAST'`; `createdAt` now from `args.createdAt`, not the `updatedAt` alias).
3. **Publisher** (`src/handlers/decision-publisher.ts`): extended `mapImage` + `PUBLISH_DECISION_UPDATE` mutation variables + response selection set with the 4 fields.
4. **Test** (`test/unit/handlers/decision-publisher.test.ts`): added TDD test that asserts the 4 fields propagate from the NewImage; extended fixture's attribute marshalling to handle `BOOL` and `NULL`.

## Out of scope

(see `out_of_scope:` frontmatter)
