---
id: event-processor-aws-sdk-pin-drift
status: queued
rank: 3
type: tooling
notes: "event-processor pins @aws-sdk/* at ^3.750.0 vs workspace ^3.1011.0 → duplicate lib-dynamodb copy; test-only instanceof hazard."
references: []
out_of_scope: []
spec: null
plan: null
topic_memory: [project_event_processor.md]
validation_gate: null
---

# event-processor `@aws-sdk/*` pin drift → duplicate `lib-dynamodb` copy

`libs/event-processor/package.json` pins its AWS SDK deps loosely + stale:

```
@aws-sdk/client-dynamodb:   ^3.750.0
@aws-sdk/client-eventbridge: ^3.750.0
@aws-sdk/lib-dynamodb:      ^3.750.0
@aws-sdk/util-dynamodb:     ^3.996.2
```

while the rest of the workspace (root `package.json`) pins `@aws-sdk/*` at
`^3.1011.0`+ (some at `^3.1024.0`/`^3.1032.0`). pnpm therefore resolves a **second
physical copy** of `@aws-sdk/lib-dynamodb` for event-processor:

- `@aws-sdk+lib-dynamodb@3.1003.0` — what event-processor's symlink targets
  (`libs/event-processor/node_modules/@aws-sdk/lib-dynamodb` → `.pnpm/…@3.1003.0…`)
- `@aws-sdk+lib-dynamodb@3.1011.0` — what every service resolves to

## Not a production bug
Lambda bundling externalizes the SDK — `externalModules: ['@aws-sdk/*']`
(`libs/cdk-constructs/src/utils/default-lambda-props.ts:26`), so at runtime the
handler uses the Node runtime's single built-in `@aws-sdk` copy. Exactly one
`PutCommand` class exists in production. The duplicate is purely a test-env artifact
of pnpm's strict (non-hoisted) `node_modules`.

## Why it bites (test only)
`IntentExecutor` (in event-processor) constructs `PutCommand` from the `3.1003.0`
class; a service test importing `PutCommand` from `3.1011.0` does an `instanceof`
check via `aws-sdk-client-mock`'s `commandCalls(PutCommand)` → fails across copies →
returns `[]`. Surfaced in w3: `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts`
passed in the symlinked worktree (deduped) but failed on real `main`. Fixed there
(commit `a66ab1f3`) by matching `ddbMock.calls()` by row shape instead — the same
drift-proof pattern already documented at
`services/ledger/ledger-bff/test/unit/version-guard.test.ts:52` (`onAnyCommand()` note).
The `calls()` pattern should stay regardless of this fix (it survives version bumps);
this item only removes the duplicate.

## Second instance — broker-ctrl (RED on `main`, found 2026-06-01)
Promoted to QUEUED 2026-06-01 during `bff-readmodel-w6-governance-freeze`'s
validation gate. `services/execution/broker-ctrl/test/unit/order-lifecycle.test.ts`
fails **on `main`** (verified: `2 failed, 62 passed`) at the two
"Deposit/Withdrawal Normalizer Integration" tests (`:739`, `:806`). Same root cause:
its `jest.mock('@aws-sdk/lib-dynamodb')` tags `PutCommand` with `_type:'Put'`, but
the handler resolves the other physical copy → real `PutCommand` → the helper
`findPutItems()` (filters `_type==='Put'`) returns `[]`. The sibling helper
`findPutItemByTypename` (line 167) already tolerates BOTH the mocked and the real
`PutCommand` (`constructor.name==='PutCommand'`) — `findPutItems` was simply never
hardened. **Two fixes available:** (a) the root dedupe below (preferred, systemic),
or (b) harden `findPutItems` to the drift-proof row-shape match like the w3
advisory-bff fix. This is the first confirmed case of the dup-module breaking a
suite on `main` (not just a worktree), so it now blocks the broker-ctrl unit gate.

## Fix
Align event-processor's `@aws-sdk/*` ranges to the workspace standard
(`^3.1011.0`, `util-dynamodb` to its workspace pin), then `pnpm install` (lockfile
churn) and run the affected-test gate. Cross-cutting: event-processor is imported by
nearly every service, so this is a workspace-wide lockfile change deserving its own
install + `pnpm nx affected -t test,lint,typecheck` pass — NOT a rider on a feature
branch. See [[project_event_processor]].
