# Workstream 3 — advisory versioned DecisionPacket projection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the advisory decision read model a versioned P1 projection of an authoritative producer (decision-workflow-ctrl), retiring the sparse-item-race band-aid + status-fragment events; re-source the AdvisoryStatus in-flight count as a P3 derived aggregate; align confirm/reject to the intent-event + optimistic-UI model.

**Architecture:** decision-workflow-ctrl is the sole writer of the `DecisionPacket` aggregate; it stamps a monotonic `__version` (DynamoDB atomic counter) on every write and persists the L2 user-confirmation task-token onto the row via a native `aws-sdk:dynamodb:updateItem.waitForTaskToken` SF state (no Lambda). DynamoDB Streams CDC (`changeDataCapture()`, full NewImage) already announces the full row as `DECISION_PACKET_CREATED`/`UPDATED`. advisory-bff projects those snapshots via `projectVersioned('DecisionReadModel', …)`, retiring the fragment-event subscriptions and the `attribute_exists` band-aid. A post-commit DDB-stream handler in advisory-bff recomputes `inFlightCount` over the projected decision rows and writes `AdvisoryStatus` (P3); dashboard-bff projects that announced aggregate (P3), dropping its `accumulate`. confirm/reject resolvers stop writing the `DecisionReadModel` projection row (they only write the `UserConfirmation`/`UserRejection` intent row carrying the token); the advisory MFE reflects the action via client-side optimistic UI.

**Tech Stack:** TypeScript, AWS CDK, AWS Step Functions (ASL CustomState), DynamoDB (lib-dynamodb), event-processor pipelines (`materializeToTable`, `changeDataCapture`, intents), AppSync JS resolvers, Angular 21 + ngrx/signals, Jest, aws-sdk-client-mock.

**Reference spec:** `docs/superpowers/specs/2026-05-30-bff-readmodel-w3-advisory-decision-packet-design.md` (+ program spec `2026-05-29-bff-read-model-materialization-redesign-design.md`).

**Status vocabulary note:** the DWC `DecisionPacket` row status values that reach the read model are `PENDING` (was `INITIATED` — realigned in Task 1.1), `APPROVED`, `AWAITING_CONFIRMATION`, `BLOCKED`, `CONFIRMED`, `REJECTED` — all present in the advisory-bff `DecisionStatus` GraphQL enum, so the projection surfaces `status` verbatim with no remap.

**Fields the full-row projection MUST carry** (no field resolvers exist on `DecisionPacket`): `decisionId, tenantId, trigger, status, proposedTrades, explanation, confirmationRequired, confirmedAt, rejectedAt, rejectionReason, createdAt, updatedAt, version (= __version), __typename='DecisionReadModel', complianceChecks: [], agentInvocations: [], taskToken`.

---

## Phase 0 — event-processor foundation completion

w0 shipped the `Projection<'P3'>` tag and the consumer `projectVersioned`, but left (a) no write path for P3 and (b) no producer-side atomic version-stamp on a command-owned row. w3 is the first consumer of both; complete them here.

### Task 0.1: Allow `projectVersioned` to write P3 (not just P1)

**Files:**
- Modify: `libs/event-processor/src/types/ownership.ts:67-68`
- Test: `libs/event-processor/test/intents/project-versioned.test.ts` (type-level + factory)

- [ ] **Step 1: Write the failing test** (type-acceptance for a P3 typename)

Append to `libs/event-processor/test/intents/project-versioned.test.ts`:

```typescript
// P3 derived aggregates are versioned snapshots too — projectVersioned must accept them.
describe('projectVersioned accepts P3 (derived aggregate) typenames', () => {
  it('compiles + returns an intent for a P3-tagged typename', () => {
    // The augmentation below mirrors a real BFF registration.
    type _Assert = ReadModelOwnershipProbe; // see module augmentation in this file
    const intent = projectVersioned('AdvisoryStatusProbe', { inFlightCount: 3 }, {
      version: 5, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    });
    expect(intent).toEqual({
      _tag: 'projectVersioned',
      typename: 'AdvisoryStatusProbe',
      fields: { inFlightCount: 3 },
      version: 5,
      overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    });
  });
});
```

At the TOP of the test file, register a probe P3 typename via declaration merging (so `RejectNonP1<'AdvisoryStatusProbe'>` resolves):

```typescript
import type { Projection } from '../../src/types/ownership';
interface ReadModelOwnershipProbe { AdvisoryStatusProbe: Projection<'P3'> }
declare module '../../src/index' {
  interface ReadModelOwnership { AdvisoryStatusProbe: Projection<'P3'> }
}
```

- [ ] **Step 2: Run typecheck to verify it fails**

Run: `pnpm nx run event-processor:typecheck`
Expected: FAIL — `Argument of type '"AdvisoryStatusProbe"' is not assignable to parameter of type 'never'` (RejectNonP1 currently rejects P3).

- [ ] **Step 3: Widen `RejectNonP1` to accept P3**

In `libs/event-processor/src/types/ownership.ts`, change the projectVersioned constraint so it rejects only command-owned + P2 (P1 and P3 are both versioned snapshots written via `projectVersioned`):

```typescript
/**
 * projectVersioned: versioned snapshots — full-entity copies (P1) AND derived
 * rollups (P3). Reject command-owned and P2 (append-log). A P3 derived aggregate
 * is mechanically a versioned full-row write, identical to P1; the variant tag is
 * semantic and still forbids accumulate/command-writes (RejectProjection). The
 * name is kept for call-site stability.
 */
export type RejectNonP1<K extends string> = K extends CommandOwnedKey | P2Key ? never : K;
```

- [ ] **Step 4: Run typecheck + factory tests to verify they pass**

Run: `pnpm nx run event-processor:typecheck && pnpm nx run event-processor:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/event-processor/src/types/ownership.ts libs/event-processor/test/intents/project-versioned.test.ts
git commit -m "feat(event-processor): projectVersioned writes P3 derived aggregates, not just P1

w0 shipped the Projection<'P3'> tag with no write path (RejectNonP1 rejected P3,
all other intents reject projections). A P3 derived aggregate is mechanically a
versioned full-row snapshot — identical to P1 — so projectVersioned is the blessed
write for both. The P1/P3 tag stays semantic and still forbids accumulate via
RejectProjection. First consumer: w3 AdvisoryStatus.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 0.2: Add an atomic `add` clause to the `update` intent (producer `__version` stamping)

`executeUpdate` only emits `SET`. The DWC `sfn-callback` must atomically increment `__version` on its command-owned `DecisionPacket` row without reading it first. Add an optional `add?: Record<string, number>` that appends a DynamoDB `ADD` clause.

**Files:**
- Modify: `libs/event-processor/src/types/write-intent.ts:38-59` (UpdateIntent)
- Modify: `libs/event-processor/src/intents/update.ts:7-29` (factory)
- Modify: `libs/event-processor/src/engine/intent-executor.ts:155-225` (executeUpdate)
- Test: `libs/event-processor/test/engine/intent-executor.test.ts` (update intent block)

- [ ] **Step 1: Write the failing test**

Add inside `describe('update intent', …)` in `libs/event-processor/test/engine/intent-executor.test.ts`:

```typescript
it('appends an ADD clause for the add option (atomic counter)', async () => {
  const intent = update('DecisionPacket', { status: 'CONFIRMED' }, {
    add: { __version: 1 },
    overrides: { pk: 'DecisionPacket#t1#d1', sk: 'DecisionPacket' },
  });
  await executor.execute(intent, fakeCtx);
  const cmd = ddbMock.commandCalls(UpdateCommand)[0].args[0].input;
  expect(cmd.UpdateExpression).toContain('SET');
  expect(cmd.UpdateExpression).toContain('ADD');
  // ADD segment increments __version by 1
  expect(cmd.ExpressionAttributeNames).toMatchObject({ '#a0': '__version' });
  expect(cmd.ExpressionAttributeValues).toMatchObject({ ':a0': 1 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run event-processor:test -- --testPathPatterns intent-executor`
Expected: FAIL — `add` not on `update()` opts / no `ADD` in expression.

- [ ] **Step 3: Thread `add` through the type + factory**

`libs/event-processor/src/types/write-intent.ts` — add to `UpdateIntent`:

```typescript
  /** Atomic counters: each entry appends `ADD #k :v` (creates attr if absent, treats missing as 0). For monotonic __version stamping on a command-owned row. */
  readonly add?: Record<string, number>;
```

`libs/event-processor/src/intents/update.ts` — add `add` to the options type and the returned intent:

```typescript
  options?: {
    removes?: string[];
    condition?: string;
    conditionNames?: Record<string, string>;
    conditionValues?: Record<string, unknown>;
    add?: Record<string, number>;
    overrides?: KeyOverrides;
  },
```
and in the returned object:
```typescript
    ...(options?.add ? { add: options.add } : {}),
```

- [ ] **Step 4: Append the ADD clause in `executeUpdate`**

In `libs/event-processor/src/engine/intent-executor.ts`, after the `REMOVE` block (line ~188) and before the `conditionNames`/`conditionValues` merge:

```typescript
    if (intent.add && Object.keys(intent.add).length > 0) {
      const addParts: string[] = [];
      let a = 0;
      for (const [field, inc] of Object.entries(intent.add)) {
        const nameKey = `#a${a}`;
        const valKey = `:a${a}`;
        names[nameKey] = field;
        values[valKey] = inc;
        addParts.push(`${nameKey} ${valKey}`);
        a++;
      }
      updateExpr += ` ADD ${addParts.join(', ')}`;
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm nx run event-processor:test -- --testPathPatterns intent-executor`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/event-processor/src/types/write-intent.ts libs/event-processor/src/intents/update.ts libs/event-processor/src/engine/intent-executor.ts libs/event-processor/test/engine/intent-executor.test.ts
git commit -m "feat(event-processor): update() supports atomic ADD clause for producer version stamping

A command-owned producer stamps a monotonic __version via ADD #__version :1 in the
same UpdateExpression as its SET, without a prior read. Used by decision-workflow-ctrl
sfn-callback to version the DecisionPacket row. Backward compatible (opt-in field).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 1 — decision-workflow-ctrl producer (version + token on the row)

### Task 1.1: Stamp `__version: 1` + align create status to `PENDING`

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts:34-55`
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/models.ts:2-14` (add `PENDING` to `WorkflowStatus`)
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-packet.repository.test.ts`

- [ ] **Step 1: Write the failing test** — assert the created item carries `__version: 1` and `status: 'PENDING'`.

Add to the repository test (mirror existing `createDecisionPacket` test; it uses aws-sdk-client-mock on `PutCommand`):

```typescript
it('stamps __version=1 and status=PENDING on create', async () => {
  ddbMock.on(PutCommand).resolves({});
  await repo.createDecisionPacket(baseInput, ctx);
  const item = ddbMock.commandCalls(PutCommand)[0].args[0].input.Item!;
  expect(item.__version).toBe(1);
  expect(item.status).toBe('PENDING');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns decision-packet.repository`
Expected: FAIL — `__version` undefined, status `'INITIATED'`.

- [ ] **Step 3: Implement** — in `createDecisionPacket`'s `item`, change `status: 'INITIATED'` → `status: 'PENDING'` and add `__version: 1`:

```typescript
      status: 'PENDING' as WorkflowStatus,
      __version: 1,
```
And in `models.ts` add `| 'PENDING'` to the `WorkflowStatus` union (keep the others).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns decision-packet.repository`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/repositories/decision-packet.repository.ts services/advisory/decision-workflow-ctrl/src/domain/models.ts services/advisory/decision-workflow-ctrl/test/unit/decision-packet.repository.test.ts
git commit -m "feat(decision-workflow-ctrl): stamp __version=1 + status PENDING on DecisionPacket create

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: sfn-callback — atomic `__version` ADD, set `confirmedAt`/`rejectedAt`, drop L2 status write

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts:60-102`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts`

- [ ] **Step 1: Write the failing tests**

Add cases asserting: (a) compliance L1 APPROVED → `update('DecisionPacket', {status:'APPROVED', complianceResult:'APPROVED', authorityLevel:'L1'}, {add:{__version:1}, …})`; (b) compliance **L2** APPROVED → update **without** `status` (only `complianceResult`+`authorityLevel`) + `add:{__version:1}`; (c) BLOCKED → status `'BLOCKED'`; (d) USER_CONFIRMED → `{status:'CONFIRMED', userDecision:'CONFIRMED', confirmedAt: <ts>}` + `add:{__version:1}`; (e) USER_REJECTED → `{status:'REJECTED', userDecision:'REJECTED', rejectedAt: <ts>, rejectionReason}` + `add:{__version:1}`. Mirror the existing sfn-callback test harness (builds `payload`/`ctx`, asserts the returned `intents`).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns sfn-callback`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace the COMPLIANCE_EVENT_TYPES and USER_RESPONSE_EVENT_TYPES handler bodies in `sfn-callback.ts`:

Compliance handler intents:
```typescript
        intents: decisionId ? [update('DecisionPacket', {
          // L2 AWAITING_CONFIRMATION is written solely by the SF
          // UpdateItem.waitForTaskToken state (single writer). Here, for L2 we
          // record only the compliance verdict; for L1 we set the terminal APPROVED;
          // BLOCKED is terminal for both.
          ...(isApproved
            ? (authorityLevel === 'L1' ? { status: 'APPROVED' } : {})
            : { status: 'BLOCKED' }),
          complianceResult: decision,
          authorityLevel,
          ...(reason ? { blockReason: reason } : {}),
        }, {
          add: { __version: 1 },
          overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
        })] : [],
```

User-response handler intents (add `confirmedAt`/`rejectedAt` + version):
```typescript
      const now = ctx.timestamp;
      ...
        intents: decisionId ? [update('DecisionPacket', {
          status: decision, // 'CONFIRMED' | 'REJECTED'
          userDecision: decision,
          ...(isConfirmed ? { confirmedAt: now } : { rejectedAt: now }),
          ...(reason ? { rejectionReason: reason } : {}),
        }, {
          add: { __version: 1 },
          overrides: { pk: `DecisionPacket#${tenantId}#${decisionId}`, sk: 'DecisionPacket' },
        })] : [],
```
(`ctx.timestamp` is the event envelope timestamp, already available on `EventContext`.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns sfn-callback`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/handlers/sfn-callback.ts services/advisory/decision-workflow-ctrl/test/unit/sfn-callback.test.ts
git commit -m "feat(decision-workflow-ctrl): sfn-callback stamps __version + confirmedAt/rejectedAt; L2 status owned by SF

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: SF `RequestUserConfirmation` → `aws-sdk:dynamodb:updateItem.waitForTaskToken` (token + AWAITING + version on the row); drop `USER_CONFIRMATION_REQUESTED` emission

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts:258-289`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts`

- [ ] **Step 1: Write the failing test** — assert the synthesized ASL for `RequestUserConfirmation` uses the SDK updateItem callback resource and writes status/taskToken/version. The existing test renders the state machine; assert against the state JSON:

```typescript
it('RequestUserConfirmation writes token + AWAITING + version via aws-sdk:dynamodb:updateItem.waitForTaskToken', () => {
  const def = JSON.parse(/* render definitionBody to ASL — mirror existing helper in this test file */);
  const state = def.States['RequestUserConfirmation'];
  expect(state.Resource).toBe('arn:aws:states:::aws-sdk:dynamodb:updateItem.waitForTaskToken');
  expect(state.Parameters.UpdateExpression).toContain('ADD #v :one');
  expect(state.Parameters.UpdateExpression).toContain('SET #s = :awaiting');
  expect(state.Parameters.UpdateExpression).toContain('taskToken = :tok');
  expect(state.Parameters.ExpressionAttributeValues[':tok']['S.$']).toBe('$$.Task.Token');
});
```
(Use whatever ASL-rendering approach the existing `decision-state-machine.test.ts` already uses for the `WaitForCompliance`/`LookupMandateSnapshot` CustomStates.)

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns decision-state-machine`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace the `requestUserConfirmation` CustomState (lines 258-289). The SF writes the AWAITING_CONFIRMATION status, the task token, and bumps `__version`, then suspends until the token returns:

```typescript
    const requestUserConfirmation = new sfn.CustomState(this, 'RequestUserConfirmation', {
      stateJson: {
        Type: 'Task',
        // AWS SDK service integration (NOT the optimized dynamodb integration,
        // which does not support .waitForTaskToken). Writes the user-confirmation
        // task token onto the DecisionPacket row so it flows through the versioned
        // CDC snapshot to advisory-bff; the confirm/reject resolver reads it back.
        // Replaces the prior putEvents(USER_CONFIRMATION_REQUESTED).waitForTaskToken.
        Resource: 'arn:aws:states:::aws-sdk:dynamodb:updateItem.waitForTaskToken',
        Parameters: {
          TableName: props.tableName,
          Key: {
            pk: { 'S.$': "States.Format('DecisionPacket#{}#{}', $.tenantId, $.decisionId)" },
            sk: { S: 'DecisionPacket' },
          },
          UpdateExpression: 'ADD #v :one SET #s = :awaiting, taskToken = :tok, updatedAt = :now',
          ExpressionAttributeNames: { '#v': '__version', '#s': 'status' },
          ExpressionAttributeValues: {
            ':one': { N: '1' },
            ':awaiting': { S: 'AWAITING_CONFIRMATION' },
            ':tok': { 'S.$': '$$.Task.Token' },
            ':now': { 'S.$': '$$.State.EnteredTime' },
          },
        },
        TimeoutSeconds: Duration.hours(72).toSeconds(),
        ResultPath: '$.userResponse',
      },
    });
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns decision-state-machine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/constructs/decision-state-machine.ts services/advisory/decision-workflow-ctrl/test/unit/decision-state-machine.test.ts
git commit -m "feat(decision-workflow-ctrl): SF persists L2 token+status+version on the row via SDK updateItem.waitForTaskToken (no Lambda)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Grant the SF role `dynamodb:UpdateItem` on the State table

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/service.stack.ts:216-217`
- Test: `services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write the failing test** — assert the SF role policy includes `dynamodb:UpdateItem` on the State table (mirror the existing `grantReadData` assertion; use `Template.fromStack` + `hasResourceProperties('AWS::IAM::Policy', …)` matching `dynamodb:UpdateItem`).

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns service.stack`
Expected: FAIL.

- [ ] **Step 3: Implement** — after `state.getTable().grantReadData(orchestration.stateMachine);` add:

```typescript
    // SF role: dynamodb:UpdateItem on the local State table for the
    // RequestUserConfirmation aws-sdk:dynamodb:updateItem.waitForTaskToken state
    // (writes token + AWAITING_CONFIRMATION + __version onto the DecisionPacket row).
    state.getTable().grantWriteData(orchestration.stateMachine);
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run decision-workflow-ctrl:test -- --testPathPatterns service.stack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/service.stack.ts services/advisory/decision-workflow-ctrl/test/unit/service.stack.test.ts
git commit -m "feat(decision-workflow-ctrl): grant SF role UpdateItem on State table for token write

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 1.5: Remove `USER_CONFIRMATION_REQUESTED` from the producer's event surface

**Files:**
- Modify: `services/advisory/decision-workflow-ctrl/src/domain/events.ts:10` (remove from `DecisionWorkflowEventTypes`)
- Modify: `services/advisory/decision-workflow-ctrl/CLAUDE.md` (Event Types section)

- [ ] **Step 1:** Remove the `USER_CONFIRMATION_REQUESTED: eventName('USER_CONFIRMATION_REQUESTED'),` line from `DecisionWorkflowEventTypes`. Grep the service for remaining references:

Run: `grep -rn "USER_CONFIRMATION_REQUESTED" services/advisory/decision-workflow-ctrl/src`
Expected: no matches (the SF state no longer emits it; the constant is gone).

- [ ] **Step 2: Run the service unit suite**

Run: `pnpm nx run decision-workflow-ctrl:test`
Expected: PASS (no consumer of the removed constant remains in this service).

- [ ] **Step 3: Commit**

```bash
git add services/advisory/decision-workflow-ctrl/src/domain/events.ts services/advisory/decision-workflow-ctrl/CLAUDE.md
git commit -m "refactor(decision-workflow-ctrl): retire USER_CONFIRMATION_REQUESTED (token now rides the versioned snapshot)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — advisory-bff consumer (versioned projection + P3 + resolver purification)

### Task 2.1: Register `ReadModelOwnership`

**Files:**
- Create: `services/advisory/advisory-bff/src/read-model-ownership.ts`

- [ ] **Step 1: Create the file** (mirror ledger-bff/dashboard-bff):

```typescript
/**
 * advisory-bff read-model ownership registration (workstream 3).
 *
 * Compile-time enforcement (see docs/architecture/READ-MODEL-OWNERSHIP.md):
 *   - DecisionReadModel : P1 → projectVersioned only (record/update/accumulate fail typecheck).
 *   - AdvisoryStatus    : P3 derived aggregate → projectVersioned only; the prior
 *     accumulate('AdvisoryStatus') no longer compiles (that is the point).
 */
import type { Projection } from '@nestfolio/event-processor';

declare module '@nestfolio/event-processor' {
  interface ReadModelOwnership {
    DecisionReadModel: Projection<'P1'>;
    AdvisoryStatus: Projection<'P3'>;
  }
}

export {};
```

- [ ] **Step 2: Commit** (compiles only once the transforms below stop using `record`/`accumulate` on these typenames — so commit together with Task 2.2/2.5. Stage now, commit at the end of Task 2.6.)

### Task 2.2: New collapsed projection transform (`decision-snapshot.ts`)

**Files:**
- Create: `services/advisory/advisory-bff/src/transforms/decision-snapshot.ts`
- Test: `services/advisory/advisory-bff/test/unit/transforms/decision-snapshot.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { projectVersioned } from '@nestfolio/event-processor';
import { decisionSnapshot } from '../../../src/transforms/decision-snapshot';

const makeUow = (type: string, subject: Record<string, unknown>) => ({
  event: { id: 'e1', type, timestamp: '2026-01-01T00:00:00.000Z', subject, context: { tenantId: 't1' } },
  payload: {}, record: {},
});

describe('decisionSnapshot transform', () => {
  const base = {
    decisionId: 'd1', tenantId: 't1', trigger: 'rebalance', status: 'PENDING',
    proposedTrades: [{ symbol: 'VTI', side: 'BUY' }], explanation: 'why',
    confirmationRequired: true, createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z', __version: 4,
  };

  it('projects a versioned full DecisionReadModel row from a DECISION_PACKET_UPDATED snapshot', () => {
    expect(decisionSnapshot(makeUow('DECISION_PACKET_UPDATED', { ...base, status: 'AWAITING_CONFIRMATION', taskToken: 'tok-1', __version: 6 }) as any)).toEqual(
      projectVersioned('DecisionReadModel', {
        decisionId: 'd1', tenantId: 't1', trigger: 'rebalance', status: 'AWAITING_CONFIRMATION',
        proposedTrades: [{ symbol: 'VTI', side: 'BUY' }], explanation: 'why', confirmationRequired: true,
        confirmedAt: undefined, rejectedAt: undefined, rejectionReason: undefined,
        complianceChecks: [], agentInvocations: [], version: 6, taskToken: 'tok-1',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }, { version: 6, overrides: { pk: 'Decision#t1#d1', sk: 'DecisionReadModel' } }),
    );
  });

  it('drops a CREATE snapshot with neither explanation nor trades (degraded path)', () => {
    expect(decisionSnapshot(makeUow('DECISION_PACKET_CREATED', { decisionId: 'd1', tenantId: 't1', explanation: '', proposedTrades: [], __version: 1 }) as any)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns decision-snapshot`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `decision-snapshot.ts`:

```typescript
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionSnapshot = {
  decisionId: string; tenantId: string; trigger: string; status: string;
  proposedTrades: unknown[]; explanation: string; confirmationRequired: boolean;
  confirmedAt?: string; rejectedAt?: string; rejectionReason?: string;
  taskToken?: string; __version: number; createdAt: string; updatedAt: string;
  [k: string]: unknown;
};

// Single transform for DECISION_PACKET_CREATED + DECISION_PACKET_UPDATED. The CDC
// subject is the full DecisionPacket row (NewImage); we project it verbatim into the
// versioned DecisionReadModel P1 row. The version guard (projectVersioned) makes
// out-of-order delivery + the old sparse-item / APPROVED→AWAITING races impossible.
export const decisionSnapshot = (
  uow: UnitOfWork<BusEvent<DecisionSnapshot>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  // Defence-in-depth: never materialize an empty row from a degraded producer path.
  const hasExplanation = typeof p.explanation === 'string' && p.explanation.length > 0;
  const hasTrades = Array.isArray(p.proposedTrades) && p.proposedTrades.length > 0;
  if (!hasExplanation && !hasTrades) return undefined;

  return projectVersioned('DecisionReadModel', {
    decisionId: p.decisionId,
    tenantId: p.tenantId,
    trigger: p.trigger,
    status: p.status,
    proposedTrades: p.proposedTrades,
    explanation: p.explanation,
    confirmationRequired: p.confirmationRequired,
    confirmedAt: p.confirmedAt,
    rejectedAt: p.rejectedAt,
    rejectionReason: p.rejectionReason,
    complianceChecks: [],   // sub-resolved via getComplianceChecks; row keeps [] placeholder
    agentInvocations: [],   // sub-resolved via getAgentInvocations; row keeps [] placeholder
    version: p.__version,   // GraphQL DecisionPacket.version mirrors the monotonic __version
    taskToken: p.taskToken, // SF callback token; read back by confirm/reject pre-step
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }, {
    version: p.__version,
    overrides: { pk: `Decision#${p.tenantId}#${p.decisionId}`, sk: 'DecisionReadModel' },
  });
};
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns decision-snapshot`
Expected: PASS.

- [ ] **Step 5:** stage (commit with Task 2.6).

### Task 2.3: AdvisoryStatus P3 recompute — repository count method

**Files:**
- Modify: `services/advisory/advisory-bff/src/repositories/advisory.repository.ts`
- Test: `services/advisory/advisory-bff/test/unit/advisory.repository.test.ts`

- [ ] **Step 1: Write the failing test** — assert `countInFlightDecisions(tenantId)` queries `tenantId-index` for `__typename='DecisionReadModel'`, filters status IN the non-terminal set, and sums `Count` across pages:

```typescript
it('countInFlightDecisions counts non-terminal DecisionReadModel rows for a tenant', async () => {
  ddbMock.on(QueryCommand).resolves({ Count: 2, Items: [], LastEvaluatedKey: undefined });
  const n = await repo.countInFlightDecisions('t1');
  const input = ddbMock.commandCalls(QueryCommand)[0].args[0].input;
  expect(input.IndexName).toBe('tenantId-index');
  expect(input.Select).toBe('COUNT');
  expect(input.FilterExpression).toContain('#status IN');
  expect(n).toBe(2);
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns advisory.repository`
Expected: FAIL.

- [ ] **Step 3: Implement** — add to `AdvisoryRepository`:

```typescript
  /** Non-terminal decision statuses for the in-flight count (P3 derived aggregate). */
  static readonly IN_FLIGHT_STATUSES = ['PENDING', 'AWAITING_CONFIRMATION'] as const;

  /** Count this tenant's DecisionReadModel rows in a non-terminal status. Paginates the COUNT. */
  readonly countInFlightDecisions = this.log('countInFlightDecisions', async (
    tenantId: string,
  ): Promise<number> => {
    const statuses = AdvisoryRepository.IN_FLIGHT_STATUSES;
    let total = 0;
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'tenantId-index',
        Select: 'COUNT',
        KeyConditionExpression: 'tenantId = :tenantId AND #typ = :typename',
        FilterExpression: `#status IN (${statuses.map((_, i) => `:s${i}`).join(', ')})`,
        ExpressionAttributeNames: { '#status': 'status', '#typ': '__typename' },
        ExpressionAttributeValues: {
          ':tenantId': tenantId, ':typename': 'DecisionReadModel',
          ...Object.fromEntries(statuses.map((s, i) => [`:s${i}`, s])),
        },
        ...(lastKey ? { ExclusiveStartKey: lastKey } : {}),
      }));
      total += result.Count ?? 0;
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);
    return total;
  });
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns advisory.repository`
Expected: PASS.

- [ ] **Step 5:** stage (commit with Task 2.6).

### Task 2.4: AdvisoryStatus P3 recompute — post-commit stream handler

**Files:**
- Create: `services/advisory/advisory-bff/src/handlers/advisory-status-projector.ts`
- Test: `services/advisory/advisory-bff/test/unit/handlers/advisory-status-projector.test.ts`

- [ ] **Step 1: Write the failing test** — a `DecisionReadModel` stream record triggers a count + a `projectVersioned('AdvisoryStatus', …)` write; an `AdvisoryStatus` record is ignored (loop guard); other typenames ignored. Mock `AdvisoryRepository.countInFlightDecisions` + the `IntentExecutor`/docClient. Mirror the dashboard-publisher test style.

```typescript
it('recomputes AdvisoryStatus on a DecisionReadModel stream record', async () => {
  countMock.mockResolvedValue(3);
  await handler(streamEvent([{ __typename: 'DecisionReadModel', tenantId: 't1', pk: 'Decision#t1#d1' }]));
  const put = ddbMock.commandCalls(PutCommand).find(c => c.args[0].input.Item?.sk === 'AdvisoryStatus');
  expect(put!.args[0].input.Item!.inFlightCount).toBe(3);
  expect(put!.args[0].input.Item!.__typename).toBe('AdvisoryStatus');
});
it('ignores AdvisoryStatus records (no recompute loop)', async () => {
  await handler(streamEvent([{ __typename: 'AdvisoryStatus', tenantId: 't1' }]));
  expect(countMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns advisory-status-projector`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — a DDB-stream handler. It reads `NewImage`, filters to `DecisionReadModel`, recomputes per affected tenant, and writes the `AdvisoryStatus` row via `projectVersioned` (P3) using the `IntentExecutor`. The version is a per-write monotonic value derived from the recompute time is unavailable (Date.now banned in lib but this is a service Lambda — `Date.now()` is allowed in service handlers); use `Date.now()` as the monotonic `__version` for the AdvisoryStatus aggregate (a derived rollup with no natural sequence):

```typescript
import type { DynamoDBStreamEvent } from 'aws-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { IntentExecutor, projectVersioned, type EventContext } from '@nestfolio/event-processor';
import { AdvisoryRepository } from '../repositories/advisory.repository';

const TABLE = process.env.TABLE_NAME!;
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const repo = new AdvisoryRepository(TABLE, ddbClient);
const executor = new IntentExecutor({ docClient, tableName: TABLE });

export const handler = async (event: DynamoDBStreamEvent): Promise<void> => {
  // Collect tenants whose DecisionReadModel rows changed (dedupe within the batch).
  const tenants = new Set<string>();
  for (const rec of event.Records) {
    const image = rec.dynamodb?.NewImage ?? rec.dynamodb?.OldImage;
    if (!image) continue;
    const row = unmarshall(image as any) as Record<string, unknown>;
    if (row.__typename !== 'DecisionReadModel') continue; // loop guard: ignore AdvisoryStatus + others
    if (typeof row.tenantId === 'string') tenants.add(row.tenantId);
  }
  for (const tenantId of tenants) {
    const inFlightCount = await repo.countInFlightDecisions(tenantId);
    const version = Date.now();
    const ctx = { tenantId, eventId: `recompute-${tenantId}-${version}`, timestamp: new Date(version).toISOString(), serviceName: 'advisory-bff' } as EventContext;
    await executor.execute(
      projectVersioned('AdvisoryStatus', { tenantId, inFlightCount }, {
        version, overrides: { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' },
      }),
      ctx,
    );
  }
};
```
(If the test harness needs `IntentExecutor`/`projectVersioned`/`EventContext` exported from `@nestfolio/event-processor`, confirm they are in `libs/event-processor/src/index.ts`; `projectVersioned` + `IntentExecutor` are already exported — add `EventContext` to the public type exports if missing.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns advisory-status-projector`
Expected: PASS.

- [ ] **Step 5:** stage (commit with Task 2.6).

### Task 2.5: Wire the stream handler + update Ingress subscriptions in the stack

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts:20-30` (Ingress) and add the projector Lambda + stream source
- Test: `services/advisory/advisory-bff/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write/adjust the failing test** — assert (a) the Ingress `eventTypes` no longer includes `DECISION_APPROVED`, `DECISION_BLOCKED`, `USER_CONFIRMATION_REQUESTED`, nor the 7 `TRIGGER_EVENT_TYPES`; it includes only `DECISION_PACKET_CREATED` + `DECISION_PACKET_UPDATED`; (b) a second `AWS::Lambda::Function` with a `DynamoDB` event source mapping exists for the projector.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns service.stack`
Expected: FAIL.

- [ ] **Step 3: Implement** — Ingress becomes:

```typescript
    const ingress = new Ingress(this, 'Ingress', {
      state,
      eventTypes: [
        DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
        DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
      ],
    });
```
Add the projector Lambda + stream source (mirror the `DecisionPublisher` wiring at lines 77-87):

```typescript
    const advisoryStatusProjector = new NodejsFunction(this, 'AdvisoryStatusProjector', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'advisory-status-projector.ts'),
      environment: { TABLE_NAME: state.getTable().tableName },
    });
    advisoryStatusProjector.addEventSource(new DynamoEventSource(state.getTable(), {
      startingPosition: StartingPosition.LATEST,
      retryAttempts: 3,
    }));
    state.getTable().grantReadWriteData(advisoryStatusProjector);
```
Remove the now-unused `ComplianceEventTypes` / `TRIGGER_EVENT_TYPES` imports if they are no longer referenced.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run advisory-bff:test -- --testPathPatterns service.stack`
Expected: PASS.

- [ ] **Step 5:** stage (commit with Task 2.6).

### Task 2.6: Rewire `event-listener.ts`; delete old transforms + tests; commit Phase 2 core

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- Delete: `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts`, `decision-status-changed.ts`, `decision-trigger-received.ts`
- Delete: the three corresponding `test/unit/transforms/*.test.ts`

- [ ] **Step 1: Rewrite `event-listener.ts`:**

```typescript
import '../read-model-ownership';
import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { decisionSnapshot } from '../transforms/decision-snapshot';

export function createHandlers() {
  return {
    [DecisionWorkflowEventTypes.DECISION_PACKET_CREATED]: (payload: any, ctx: any) =>
      decisionSnapshot(toUow(payload, ctx) as any),
    [DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED]: (payload: any, ctx: any) =>
      decisionSnapshot(toUow(payload, ctx) as any),
  };
}

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: createHandlers(),
  errorEventType: 'ADVISORY_BFF_FAILED',
});
```

- [ ] **Step 2: Delete the obsolete transforms + tests**

```bash
git rm services/advisory/advisory-bff/src/transforms/decision-packet-created.ts \
       services/advisory/advisory-bff/src/transforms/decision-status-changed.ts \
       services/advisory/advisory-bff/src/transforms/decision-trigger-received.ts \
       services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts \
       services/advisory/advisory-bff/test/unit/transforms/decision-status-changed.test.ts \
       services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts
```

- [ ] **Step 3: Run the full advisory-bff unit + typecheck**

Run: `pnpm nx run advisory-bff:typecheck && pnpm nx run advisory-bff:test`
Expected: PASS — `read-model-ownership` now compiles (no `record`/`accumulate`/`updateOrRetry` on `DecisionReadModel`/`AdvisoryStatus` remain), the new `decisionSnapshot` + projector + repository tests pass.

- [ ] **Step 4: Commit Phase 2 core**

```bash
git add -A services/advisory/advisory-bff
git commit -m "feat(advisory-bff): versioned DecisionReadModel P1 projection + AdvisoryStatus P3 recompute

Collapse decision-packet-created/decision-status-changed/decision-trigger-received
into one decisionSnapshot transform projecting DECISION_PACKET_CREATED/UPDATED via
projectVersioned; drop the attribute_exists band-aid, the Bug-E ignore-UPDATED
workaround, the L2 no-op, and the DECISION_APPROVED/BLOCKED/USER_CONFIRMATION_REQUESTED
+ 7-trigger subscriptions. AdvisoryStatus inFlightCount becomes a P3 derived aggregate
recomputed post-commit over the projected decision rows. Register ReadModelOwnership.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 2.7: Resolver purification — confirm/reject stop writing the projection row

The `DecisionReadModel` row is now a P1 projection (sole writer = the projection). The confirm/reject resolvers must NOT write it; they keep only the `UserConfirmation`/`UserRejection` intent row (carrying `taskToken`), whose CDC re-emits `USER_CONFIRMED`/`USER_REJECTED` → resumes the SF → DWC updates the row → projection reflects the terminal status.

**Files:**
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/confirm-decision.fn.js`
- Modify: `services/advisory/advisory-bff/src/graphql/js-function/reject-decision.fn.js`

- [ ] **Step 1:** In `confirm-decision.fn.js`, remove the first `TransactWriteItems` entry (the `UpdateItem` on `sk: 'DecisionReadModel'`, lines 40-54). Keep ONLY the `UserConfirmation` `PutItem` (with `taskToken`). Since a single-item transaction is now just a put, simplify to:

```javascript
  return {
    operation: 'PutItem',
    key: util.dynamodb.toMapValues({ pk, sk: `UserConfirmation#${util.autoId()}` }),
    attributeValues: util.dynamodb.toMapValues(userConfirmationAttrs),
  };
```
The `response` still returns `ctx.prev.result` (the readback row from the `get-decision-readback` pre-step), which reflects the pre-confirmation status — the MFE supplies the optimistic CONFIRMED (Task 3).

- [ ] **Step 2:** Apply the identical change to `reject-decision.fn.js` (drop the `DecisionReadModel` UpdateItem; keep the `UserRejection` PutItem with `taskToken` + `rejectionReason`).

- [ ] **Step 3:** Grep to confirm no resolver writes `sk: 'DecisionReadModel'` anymore:

Run: `grep -rn "DecisionReadModel" services/advisory/advisory-bff/src/graphql`
Expected: only READS remain (`get-decision.fn.js`, `get-decision-readback.fn.js`, `get-pending-decisions.fn.js`, `get-decision-history.fn.js`). No `UpdateItem`/`PutItem` on `sk: 'DecisionReadModel'`.

- [ ] **Step 4: Run advisory-bff unit/lint** (resolvers are linted, not unit-tested here):

Run: `pnpm nx run advisory-bff:lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/confirm-decision.fn.js services/advisory/advisory-bff/src/graphql/js-function/reject-decision.fn.js
git commit -m "refactor(advisory-bff): confirm/reject emit only the UserConfirmation/Rejection intent row

DecisionReadModel is now a P1 projection — its sole writer is projectVersioned. The
resolver no longer writes status onto the projection row (that would be a command
write to a projection, wiped by the next snapshot). The SF still resumes via the
UserConfirmation/Rejection CDC carrying taskToken; the terminal status arrives via
the projection. UI reflects the action optimistically (see advisory-mfe).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — advisory MFE optimistic UI

The confirm/reject mutation response now returns the pre-confirmation row (status still `AWAITING_CONFIRMATION`). The component must flip the badge optimistically and let the WSS projection frame reconcile. The Playwright gate asserts the success banner (`store.setSuccess`), which is unchanged.

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision/decision-detail.component.ts:432-468`

- [ ] **Step 1: Write/adjust the failing test** — if a component spec exists (`decision-detail.component.spec.ts`), assert that after `onConfirm()` the store status is `CONFIRMED` even when the mutation resolves with `status: 'AWAITING_CONFIRMATION'`. If no spec exists, add a focused one mocking `AdvisoryService.confirmDecision` to resolve a stale row.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run advisory-mfe:test`
Expected: FAIL (status not optimistically updated).

- [ ] **Step 3: Implement** — make `onConfirm`/`onReject` optimistic; do NOT overwrite the optimistic state with the (now-stale) mutation response; revert on error:

```typescript
  async onConfirm(): Promise<void> {
    const current = this.store.decision();
    if (!current) return;
    this.actionType = 'confirm';
    this.store.setLoading(true);
    // Optimistic: flip the badge now; the authoritative CONFIRMED arrives via the
    // onDecisionUpdate projection frame (version >= current.version so it lands).
    this.store.setDecision({ ...current, status: 'CONFIRMED' });
    try {
      await this.advisoryService.confirmDecision(current.decisionId);
      this.store.setSuccess(this.translate.instant('advisory.detail.confirmSuccess'));
    } catch (e: unknown) {
      this.store.setDecision(current); // revert optimistic update
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
      this.actionType = null;
    }
  }

  async onReject(): Promise<void> {
    const current = this.store.decision();
    if (!current) return;
    this.actionType = 'reject';
    this.store.setLoading(true);
    this.store.setDecision({ ...current, status: 'REJECTED' });
    try {
      await this.advisoryService.rejectDecision(current.decisionId, this.rejectReason.trim());
      this.showRejectDialog = false;
      this.rejectReason = '';
      this.store.setSuccess(this.translate.instant('advisory.detail.rejectSuccess'));
    } catch (e: unknown) {
      this.store.setDecision(current); // revert
      this.store.setError(parseError(e, 'errors.decision'));
    } finally {
      this.store.setLoading(false);
      this.actionType = null;
    }
  }
```
(Keep the existing subscription version-guard at lines 400-405; the real CONFIRMED frame carries `version = __version > current.version`, so it lands and reconciles. The optimistic `setDecision` keeps `version: current.version`, so it never blocks the real frame.)

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run advisory-mfe:test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision/decision-detail.component.ts
git commit -m "feat(advisory-mfe): optimistic confirm/reject UI (intent-event model)

The confirm/reject mutation no longer returns the new status (the resolver stopped
writing the DecisionReadModel projection). Flip the badge optimistically; the
authoritative status arrives via the onDecisionUpdate projection frame. Revert on error.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — dashboard-bff projects the announced AdvisoryStatus (P3)

advisory-bff now emits `ADVISORY_STATUS_UPDATED` (its existing Egress already maps `AdvisoryStatus → ADVISORY_STATUS_UPDATED`). Forward it cross-domain and have dashboard-bff project it, dropping its own `accumulate`.

### Task 4.1: Declare + forward `ADVISORY_STATUS_UPDATED` cross-domain

**Files:**
- Modify: `services/advisory/advisory-adpt/src/domain/events.ts` (`AdvisoryCrossDomainEventTypes`)
- Modify: `services/investor/investor-adpt/src/domain/events.ts` (`InvestorIngestEventTypes`, "From Advisory" block)
- Modify: `services/investor/investor-adpt/src/service.stack.ts:38-47` (`fromAdvisoryEvents`)
- Test: `services/investor/investor-adpt/test/unit/service.stack.test.ts`

- [ ] **Step 1: Write the failing test** — assert the Advisory→Investor rule's `detailType` set includes `ADVISORY_STATUS_UPDATED`.

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run investor-adpt:test -- --testPathPatterns service.stack`
Expected: FAIL.

- [ ] **Step 3: Implement** — add `ADVISORY_STATUS_UPDATED: eventName('ADVISORY_STATUS_UPDATED')` to `AdvisoryCrossDomainEventTypes` and to `InvestorIngestEventTypes` (From Advisory), then add `InvestorIngestEventTypes.ADVISORY_STATUS_UPDATED` to the `fromAdvisoryEvents` array.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm nx run investor-adpt:test -- --testPathPatterns service.stack`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add services/advisory/advisory-adpt/src/domain/events.ts services/investor/investor-adpt/src/domain/events.ts services/investor/investor-adpt/src/service.stack.ts services/investor/investor-adpt/test/unit/service.stack.test.ts services/investor/investor-adpt/CLAUDE.md
git commit -m "feat(investor-adpt): forward ADVISORY_STATUS_UPDATED advisory->investor

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: dashboard-bff projects AdvisoryStatus (P3), drops accumulate

**Files:**
- Modify: `services/investor/dashboard-bff/src/read-model-ownership.ts` (register `AdvisoryStatus: Projection<'P3'>`)
- Rewrite: `services/investor/dashboard-bff/src/transforms/advisory-status.ts`
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/src/service.stack.ts` (Ingress)
- Test: rewrite `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts`; adjust `event-listener`/`service.stack` tests

- [ ] **Step 1: Write the failing transform test**

```typescript
import { projectVersioned } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../../src/transforms/advisory-status';

const makeUow = (subject: Record<string, unknown>) => ({
  event: { id: 'e1', type: 'ADVISORY_STATUS_UPDATED', timestamp: '2026-01-01T00:00:00.000Z', subject, context: { tenantId: 't1' } },
  payload: {}, record: {},
});

it('projects the announced AdvisoryStatus aggregate (P3)', () => {
  expect(advisoryStatus(makeUow({ tenantId: 't1', inFlightCount: 3, __version: 99 }) as any)).toEqual(
    projectVersioned('AdvisoryStatus', { tenantId: 't1', inFlightCount: 3 }, {
      version: 99, overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    }),
  );
});
```

- [ ] **Step 2: Run to verify fail**

Run: `pnpm nx run dashboard-bff:test -- --testPathPatterns advisory-status`
Expected: FAIL.

- [ ] **Step 3: Implement** the transform:

```typescript
import { projectVersioned, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

// dashboard-bff projects advisory-bff's authoritative AdvisoryStatus aggregate
// (P3, projected from the owner's versioned announcement). No accumulate.
export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<{ tenantId: string; inFlightCount: number; __version: number }>>,
): WriteIntent | undefined => {
  const p = uow.event.subject;
  if (typeof p.__version !== 'number') return undefined;
  return projectVersioned('AdvisoryStatus', {
    tenantId: p.tenantId,
    inFlightCount: p.inFlightCount,
  }, { version: p.__version, overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' } });
};
```
Register `AdvisoryStatus: Projection<'P3'>` in `read-model-ownership.ts` (remove the "deferred to w3" comment). In `event-listener.ts`, replace ALL the `advisoryStatus(...)` dispatches (on the 7 triggers + DECISION_APPROVED/BLOCKED + INVESTOR_PROFILE_*) with a single `[AdvisoryCrossDomainEventTypes.ADVISORY_STATUS_UPDATED]: (payload, ctx) => advisoryStatus(toUow(payload, ctx))`. Keep the `recentActivity` dispatches on DECISION_* etc. In `service.stack.ts`, add `InvestorIngestEventTypes.ADVISORY_STATUS_UPDATED` to the Ingress and remove the trigger subscriptions that were ONLY feeding `advisoryStatus` (keep any still needed by `recentActivity`/`investorSnapshot`/`positionSnapshot` — verify each: `ORDER_FILLED/REJECTED/CANCELLED` + `PORTFOLIO_DRIFT_DETECTED` were advisory-status-only → remove; `INVESTOR_PROFILE_*`/`DEPOSIT_DETECTED`/`MANDATE_ISSUED` feed other transforms → keep).

- [ ] **Step 4: Run dashboard-bff typecheck + unit**

Run: `pnpm nx run dashboard-bff:typecheck && pnpm nx run dashboard-bff:test`
Expected: PASS — `accumulate('AdvisoryStatus')` is gone (would now fail typecheck), the projection test passes.

- [ ] **Step 5: Commit**

```bash
git add -A services/investor/dashboard-bff
git commit -m "feat(dashboard-bff): project AdvisoryStatus P3 from advisory-bff's announced aggregate

Drop the accumulate-from-disparate-triggers counter; subscribe ADVISORY_STATUS_UPDATED
and projectVersioned it. Register AdvisoryStatus as Projection<'P3'> (resolves the w2
carry-over). Removes the advisory-status-only trigger subscriptions.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Phase 5 — derived docs, validation, deploy, e2e

### Task 5.1: Regenerate service cards + typecheck/lint/unit

- [ ] **Step 1:** Regenerate the affected service CLAUDE.md cards (`audit-service` per `detect-doc-derivation`): `decision-workflow-ctrl`, `advisory-bff`, `dashboard-bff`, `investor-adpt`. Update the Ingress/Transforms/Handlers/Event-Types sections to match the new code. Commit.

- [ ] **Step 2:** Add the formalized rule to the w3 design doc + flag for w6: *"A user action mutating an entity this BFF does not own is emitted as an intent event (an intent row whose CDC announces it) + client-side optimistic UI — never a local write to the projection row."* Commit.

- [ ] **Step 3: Run the affected gate**

Run: `pnpm nx affected -t test,lint,typecheck --base=origin/main`
Expected: PASS across event-processor, decision-workflow-ctrl, advisory-bff, dashboard-bff, investor-adpt, advisory-mfe.

### Task 5.2: Deploy to dev sandbox

- [ ] **Step 1:**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=decision-workflow-ctrl,advisory-bff,dashboard-bff,investor-adpt 2>&1 | tee /tmp/w3-deploy.log`
Expected: exit 0. **Watch for the `aws-sdk:dynamodb:updateItem.waitForTaskToken` state** — confirm CloudFormation accepts the state machine definition (the SDK integration is unprecedented in this repo; if synth/deploy rejects the resource ARN, fall back to a `lambda:invoke.waitForTaskToken` token-writer Lambda — see Risk note below — and re-run from Task 1.3).

### Task 5.3: Integration tests

- [ ] **Step 1:**

Run: `pnpm nx affected -t test-integration --base=origin/main`
Expected: PASS — advisory-bff version-guard/stale-drop projection + token round-trip; decision-workflow-ctrl `__version` stamping; dashboard-bff AdvisoryStatus projection. (If a new integration assertion is needed for the version-guard, add it under `services/advisory/advisory-bff/test/integration/` mirroring the dashboard-bff w2 version-guard tests.)

### Task 5.4: Scoped e2e (involved scenarios only)

- [ ] **Step 1: Jest e2e (advisory decision flow)**

Run: `NODE_OPTIONS='--experimental-vm-modules' NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features -- --testPathPatterns 'advisory/(accept|reject)-decision'`
Expected: PASS — `accept-decision` asserts `CONFIRMED`, `reject-decision` asserts `REJECTED` + reason (these hit the BFF mutation + re-query; the projection must reflect the terminal status).

- [ ] **Step 2: Playwright (L2 confirm path)**

Run: `pnpm nx run nestfolio-e2e:e2e -- --grep 'new-investor-happy-path'`
Expected: PASS — `advisory.confirm()` + `waitForConfirmed()` (success banner). If it fails-then-passes on rerun, pull CloudWatch from the failing window (decision-workflow-ctrl SF execution history: confirm the `RequestUserConfirmation` state wrote the token + the SF resumed on `USER_CONFIRMED`) before continuing; run a second confirmation pass. See [[feedback-flake-means-broken]].

- [ ] **Step 3:** If green twice, proceed to ship.

---

## Follow-ups to file via `backlog-add` (do NOT block w3)

- **dashboard-bff `MANDATE_ISSUED` dead branch** — declared in the old `advisory-status` `TRIGGER_TYPES` + Ingress but never dispatched in the handler map; obsolete after Phase 4 removes the accumulate. Confirm it's fully removed; if any vestige remains, file a cleanup.
- **w6 governance formalization** — record the two new rules for w6: (1) `projectVersioned` is the blessed write for P1 **and** P3 versioned projections; (2) intent-event + client-side optimistic UI for user actions on non-owned entities (no projection-row command write). Add to `event-processor-patterns` + `create-feature`/`create-mfe` + the `audit-*` drift checks.

## Risk note — `aws-sdk:dynamodb:updateItem.waitForTaskToken` (Task 1.3)

Valid per AWS SF docs (AWS SDK integrations support `.waitForTaskToken` when the API has a field to place the token; `UpdateItem` qualifies via `ExpressionAttributeValues`), but this repo has **zero precedent** for the `aws-sdk:*` integration form (it uses the optimized `dynamodb:updateItem`, which does NOT support callbacks). If CloudFormation/synth rejects it at Task 5.2, fall back to a minimal `RequestUserConfirmation` = `lambda:invoke.waitForTaskToken` whose Lambda does the same `UpdateItem` (`status=AWAITING_CONFIRMATION`, `taskToken=$$.Task.Token`, `ADD __version`) and returns — same row outcome, at the cost of one tiny Lambda. The downstream design (projection carries the token) is unchanged.

## Self-review

- **Spec coverage:** producer version-stamping (Tasks 0.2, 1.1, 1.2, 1.3) ✓; native token-on-row, no Lambda (1.3) ✓; retire fragment events + band-aid (1.5, 2.6) ✓; DecisionReadModel P1 projection (2.1, 2.2, 2.6) ✓; AdvisoryStatus P3 owner-derived + dashboard-projected (2.3, 2.4, 4.2) ✓; intent-event + optimistic UI (2.7, 3) ✓; ownership registrations (2.1, 4.2) ✓; L2 single-writer (1.2, 1.3) ✓; cross-domain forwarding (4.1) ✓; deploy + integration + scoped e2e (5.2–5.4) ✓.
- **Placeholder scan:** none — every code step has concrete code; the one fallback (Risk note) is a contingency, not a placeholder.
- **Type/name consistency:** `decisionSnapshot` used in 2.2/2.6; `countInFlightDecisions` in 2.3/2.4; `__version` (DDB attr) vs `version` (GraphQL field) mapping is explicit in 2.2; `projectVersioned` P3 acceptance (0.1) is what makes `AdvisoryStatus`/`DecisionReadModel` registrations compile (2.1, 4.2).
