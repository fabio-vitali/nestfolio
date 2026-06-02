---
id: event-processor-readmodel-hardening
status: queued
rank: 1
type: refactor
notes: "Foundation/unblocker for the read-model program: (A) dedupe event-processor's @aws-sdk/* pin (^3.750.0) to the workspace standard so the duplicate lib-dynamodb copy stops breaking worktree tests (the WS-D/broker-ctrl hazard); (B) harden the single-fn handler branch so an undefined transform drops cleanly instead of throwing. Merges event-processor-aws-sdk-pin-drift + event-processor-single-fn-handler-undefined-throws."
references: []
spec: null
plan: null
topic_memory: [project_event_processor.md, project_read_model_redesign.md]
out_of_scope:
  - "The two band-aids that already mask part of (A) — advisory-bff row-shape match (commit a66ab1f3) and broker-ctrl findPutItems row-shape match — stay until the root dedupe lands; this WS removes the duplicate so they CAN be reverted, but reverting them is optional follow-up."
validation_gate: null
---

# event-processor read-model foundation hardening

Ranked first: both are `@nestfolio/event-processor` library fixes the rest of the
program builds on, and (A) clears a worktree-test hazard that otherwise bites
WS-D's broker-ctrl work. Merges two formerly-separate items.

## A. `@aws-sdk/*` pin drift → duplicate `lib-dynamodb` copy

`libs/event-processor/package.json` pins `@aws-sdk/client-dynamodb`,
`client-eventbridge`, `lib-dynamodb` at `^3.750.0` (and `util-dynamodb` `^3.996.2`)
while the workspace root pins `@aws-sdk/*` at `^3.1011.0`+. pnpm therefore resolves
a **second physical copy** of `@aws-sdk/lib-dynamodb` for event-processor
(`@3.1003.0` vs every service's `@3.1011.0`).

**Not a production bug** — Lambda bundling externalizes the SDK
(`externalModules: ['@aws-sdk/*']`, `libs/cdk-constructs/src/utils/default-lambda-props.ts:26`),
so at runtime there is one built-in copy. It is a test-env artifact of pnpm's
strict node_modules.

**Why it bites (test only):** `IntentExecutor` builds `PutCommand` from the
`3.1003.0` class; a service test importing `PutCommand` from `3.1011.0` does an
`instanceof` check via `aws-sdk-client-mock`'s `commandCalls(PutCommand)` → fails
across copies → `[]`. Two confirmed cases:
- advisory-bff `advisory-status-projector.test.ts` (w3) — passed in the symlinked
  worktree but failed on real `main`; fixed (commit `a66ab1f3`) via row-shape match.
- broker-ctrl `order-lifecycle.test.ts` (found 2026-06-01, `2 failed, 62 passed` on
  `main`) — `findPutItems()` filtered `_type==='Put'` and missed the real
  `PutCommand`; unblocked via the row-shape match (`input.Item`), green 64/64. First
  case of the dup-module breaking a suite on `main`, not just a worktree.

**Root fix:** align event-processor's `@aws-sdk/*` ranges to the workspace standard
(`^3.1011.0`; `util-dynamodb` to its workspace pin), `pnpm install` (lockfile
churn), then `pnpm nx affected -t test,lint,typecheck`. event-processor is imported
by nearly every service, so this is a workspace-wide lockfile change deserving its
own install pass — NOT a rider on a feature branch. The drift-proof `calls()` /
row-shape matching pattern (`services/ledger/ledger-bff/test/unit/version-guard.test.ts:52`)
stays regardless — it survives version bumps. See [[project_event_processor]].

## B. Single-function handler: `undefined` throws instead of dropping

When a handler is a **bare single function** and its transform returns `undefined`
(the documented "drop, don't write" path), the engine throws instead of dropping:

- `libs/event-processor/src/engine/normalize-handler.ts` single-`HandlerFn` branch
  (~L33-36): `toArray(undefined)` → `[undefined]`. Unlike the array branch
  (~L17-29) it does NOT filter via `isWriteIntent`.
- That `[undefined]` reaches `ingestion-engine.ts` (~L91): `intents.map(i => i._tag)`
  → `TypeError` → retryable → SQS redrive → DLQ, NOT a clean drop.

Shared by every nullable single-fn transform in
`services/investor/dashboard-bff/src/handlers/event-listener.ts` (`investor-snapshot.ts`,
`advisory-status.ts`, the `RECONCILIATION_COMPLETED → portfolio-summary` entry).
Pre-existing (inherited from the advisory-status wiring). Live probability is LOW
post-w3/w4 (producers always stamp `__version`, so the undefined path is only hit by
legacy/transitional events — none in disposable dev), but the failure mode is wrong.

**Root fix (hardens repo-wide):** in the single-fn branch of `normalize-handler.ts`,
`return toArray(result).filter(isWriteIntent);`. Add a handler-level test asserting
an undefined-producing event yields zero intents, not a throw.
