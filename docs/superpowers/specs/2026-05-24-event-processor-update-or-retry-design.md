# event-processor `updateOrRetry()` — design spec

**Workstream:** `new-investor-happy-path-pending-at-decision-confirm` (Complex lane)
**Date:** 2026-05-24
**Status:** approved (Option B from brainstorming)

## Problem

advisory-bff's `decisionStatusChanged` transform issues:

```ts
update('DecisionReadModel', fields, {
  condition: 'attribute_exists(pk)',
  overrides: { pk: `Decision#${tenantId}#${decisionId}`, sk: 'DecisionReadModel' },
});
```

with the intent "wait until the row exists, then update". The event-processor's `executeUpdate` (`libs/event-processor/src/engine/intent-executor.ts:166-175`) intentionally swallows `ConditionalCheckFailedException` on a `condition`-bearing update as `{ _tag: 'update', success: true, deduplicated: true }`. SQS sees `success` and acks the message. The status transition is silently lost.

This is the documented "guarded update" / "skip-if-not-X" semantic — correct for dedup use cases (e.g., `record()`'s `attribute_not_exists(pk)` collision check). The contract is wrong only for callers that want a "wait" semantic.

The race manifests because:

- `decision-workflow-ctrl` table CDC emits `DECISION_PACKET_CREATED` (from AssemblePacket Lambda's row write).
- `compliance-ctrl` table CDC emits `DECISION_BLOCKED` / `DECISION_APPROVED` (from rule-engine's row write).
- decision-workflow-ctrl SF also emits `USER_CONFIRMATION_REQUESTED` from the L2 branch.

All three streams race through independent EB → SQS paths to advisory-bff. Ordering is not guaranteed end-to-end. When a status event lands first, the silent dedup kicks in and the row sticks at `status: 'PENDING'`.

## Design

Add a second update policy to `event-processor` that distinguishes "skip-if-not-X" from "wait-until-X". Existing `update({condition})` semantics are preserved.

### Public API

```ts
// libs/event-processor/src/types/write-intent.ts

export type UpdateIntent = {
  _tag: 'update';
  typename: string;
  updates: Record<string, unknown>;
  condition?: string;
  conditionNames?: Record<string, string>;
  conditionValues?: Record<string, unknown>;
  removes?: string[];
  overrides?: { pk?: string; sk?: string };

  /**
   * Behavior on ConditionalCheckFailedException when `condition` is set.
   * - 'skip' (default) — return `{ success: true, deduplicated: true }`.
   *   Use for dedup / skip-if-not-X patterns.
   * - 'retry' — re-throw so SQS redrives the message. Use for
   *   wait-until-X patterns where the precondition is expected to
   *   become true on a subsequent delivery (e.g., another event
   *   creates the row first).
   */
  onConditionFail?: 'skip' | 'retry';
};

/**
 * Sugar over `update()` with `onConditionFail: 'retry'`. Use when the
 * condition expresses a precondition that must be true for the write
 * to make sense — and you want SQS redrive (not silent skip) if the
 * precondition isn't met yet at delivery time.
 */
export function updateOrRetry(
  typename: string,
  fields: Record<string, unknown>,
  opts: {
    condition: string;
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    removes?: string[];
    overrides?: { pk?: string; sk?: string };
  },
): UpdateIntent;
```

`updateOrRetry()` is a thin factory that sets `onConditionFail: 'retry'` on the intent. Call sites stay one-line. Discoverability via grep is improved because the new name surfaces the policy explicitly.

**The `update()` factory does NOT accept `onConditionFail`.** There is exactly one way to opt into retry semantics: call `updateOrRetry()`. This keeps the public surface narrow and the call-site signal unambiguous — a reader scanning a transform sees `updateOrRetry` (retry on miss) vs `update({condition})` (skip on miss) without having to compare opts objects.

### Executor branch

```ts
// libs/event-processor/src/engine/intent-executor.ts:166-175

} catch (error: unknown) {
  if (
    intent.condition
    && error instanceof Error
    && error.name === 'ConditionalCheckFailedException'
  ) {
    if (intent.onConditionFail === 'retry') {
      // Surface to SQS for redrive — caller declared the condition is
      // a precondition that should hold on a later delivery.
      throw error;
    }
    // Default: skip-if-not-X semantic.
    return { _tag: 'update', success: true, deduplicated: true };
  }
  throw error;
}
```

No change for callers that omit `onConditionFail` or pass `'skip'`. Behavior change is opt-in.

### Call-site change

```ts
// services/advisory/advisory-bff/src/transforms/decision-status-changed.ts

import { updateOrRetry, ... } from '@nestfolio/event-processor';

return updateOrRetry('DecisionReadModel', fields, {
  condition: 'attribute_exists(pk)',
  overrides: {
    pk: `Decision#${uow.event.subject.tenantId}#${uow.event.subject.decisionId}`,
    sk: 'DecisionReadModel',
  },
});
```

One-line swap. No other transforms change.

## Behavior on SQS redrive

When `updateOrRetry()` throws ConditionalCheckFailed:

1. The SQS message is not acked; it returns to the queue after the visibility timeout.
2. It is redelivered (subject to `maxReceiveCount`).
3. On redelivery, the racing CREATE has typically landed (the race window is sub-second; SQS visibility timeout is multi-second).
4. The update applies.
5. If the CREATE truly never lands (e.g., upstream Lambda failure), the message exhausts retries and lands in the existing DLQ.

This matches the documented behavior expected by [[feedback-no-silent-fallback-in-agent-results]]: failure modes that should retry MUST not be silently swallowed. The new policy makes that explicit and opt-in.

## Idempotency

`update()` is naturally idempotent at DDB level — applying the same `SET` twice is a no-op visible state change. Retries do not cause double-application of side effects. No new guard marker needed.

Ordering: if multiple status events for the same decision arrive (e.g., DECISION_BLOCKED then USER_CONFIRMATION_REQUESTED), advisory-bff applies them in arrival order. Last-write-wins on `status`. This matches today's behavior; the dedup-on-condition-fail bug never affected ordering when both events arrived after the row existed.

## Out of scope

- **No migration of existing `update({condition})` callers.** The default policy stays `'skip'`. We do not audit or change other transforms unless they surface the same bug under their own backlog item.
- **No change to `record()`'s `attribute_not_exists(pk)` dedup.** That is the correct semantic and stays.
- **No change to AssemblePacket's `narrative.explainability.rationale` path bug.** Filed separately (out_of_scope on the parent dossier).
- **No change to the suitability-blocked LLM non-determinism.** Filed separately.

## Testing strategy

### Unit — event-processor

`libs/event-processor/test/intents/intents.test.ts` already covers `update()`. Add:

1. `updateOrRetry()` produces an intent with `_tag: 'update'`, `onConditionFail: 'retry'`, and the supplied `condition`.
2. `executeUpdate` with `onConditionFail: 'retry'` re-throws `ConditionalCheckFailedException` (currently returns `deduplicated: true`).
3. `executeUpdate` with `onConditionFail: 'skip'` (and undefined) preserves current `deduplicated: true` behavior.
4. `executeUpdate` with `onConditionFail: 'retry'` and a DIFFERENT exception still throws as today.

### Unit — advisory-bff

`services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts` exists. Add:

5. The intent returned by `decisionStatusChanged` carries `onConditionFail: 'retry'` (or use `updateOrRetry` factory and assert the resulting tag).
6. Existing tests that assert the intent shape pass without modification (`fields`, `condition`, `overrides`).

### Integration

`services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`:

7. Emit `DECISION_BLOCKED` BEFORE `DECISION_PACKET_CREATED` for the same `(tenantId, decisionId)`. Assert: after both events drain, the DecisionReadModel row has `status: 'BLOCKED'` (not `'PENDING'`).
8. Existing happy-path order (CREATED before BLOCKED) continues to land at `status: 'BLOCKED'`.

The harness already supports out-of-order delivery via `EventBusTrap` + manual emission ordering.

### E2E

`apps/nestfolio-e2e/src/journeys/new-investor-happy-path.spec.ts` is the ultimate validation gate. **Run by the user post-merge** — per `feedback_always_rerun_e2e` this skill must NOT run `apps/nestfolio-e2e` automatically. The closing phase validation gate cites the integration assertion + one manual Playwright pass.

Note on Bug C (LLM non-determinism): the test can still fail with `status: 'BLOCKED'` if the LLM produces a suitability-violating allocation. This fix does NOT close Bug C. The first post-fix Playwright run may need a rerun; if it shows BLOCKED, the integration test confirms the badge transitions correctly (just to BLOCKED not AWAITING_CONFIRMATION). Bug C will be filed separately and addressed in a follow-up.

## Validation gate

- `pnpm nx affected -t test,lint --base=origin/main` green.
- `pnpm nx affected -t test-integration --base=origin/main` green, including the new out-of-order test.
- Deploy: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff`.
- Manual Playwright pass of `new-investor-happy-path` — by the user, not by this skill.

## Risk

Low. The behavior change is opt-in. Existing callers see no semantic change. The new code path (throw on ConditionalCheckFailed → SQS redrive) is the standard event-processor failure model used by every other intent type.

Cold start of advisory-bff handler is unchanged; `updateOrRetry` is a 3-line factory.

## References

- Root cause file: `services/advisory/advisory-bff/src/transforms/decision-status-changed.ts:44-50`
- Executor swallow site: `libs/event-processor/src/engine/intent-executor.ts:166-175`
- Default status: `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts:37`
- Suitability check that legitimately BLOCKS: `services/advisory/compliance-ctrl/src/rules/suitability-checker.ts:47`
- Anti-pattern family: `feedback_no_silent_fallback_in_agent_results.md`
- Topic memory: `project_decision_workflow_stuck.md`
