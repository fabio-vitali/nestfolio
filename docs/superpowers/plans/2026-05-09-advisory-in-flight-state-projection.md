# Advisory In-Flight State Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project the "decision being computed" system state into both advisory-bff and dashboard-bff so advisory-mfe can render a "generating" branch and the dashboard alert advances at trigger time. Eliminates the empty-state ambiguity on `/advisory` and satisfies the BFF state completeness principle.

**Architecture:** Both BFFs subscribe to the 7 SF trigger events (`INVESTOR_PROFILE_CREATED`, `INVESTOR_PROFILE_UPDATED`, `PORTFOLIO_DRIFT_DETECTED`, `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `DEPOSIT_DETECTED` — already federated to their respective buses). advisory-bff projects a new tenant-scoped `AdvisoryStatus` aggregate (`inFlightCount`, `lastTriggerAt`) exposed via `getAdvisoryStatus` query and `onAdvisoryStatusUpdate` subscription. dashboard-bff's existing `pendingDecisionsCount` semantics shift from "decisions awaiting review" to "any in-progress decision" (+1 on triggers, -1 on APPROVED/BLOCKED). advisory-mfe reads both queries on init and subscribes to both channels for realtime updates. No new domain events. investor-adpt forwards `PORTFOLIO_DRIFT_DETECTED` from ledgerBus to investorBus to complete dashboard-bff's subscription coverage.

**Tech Stack:** AWS CDK, EventBridge, DynamoDB Streams, AppSync GraphQL (JS resolvers), Lambda (Node 20 ARM64), `@nestfolio/event-processor` (record/accumulate/update intents), Angular 21, NgRx Signals, AppSync `@aws_subscribe`.

**Spec:** `docs/superpowers/specs/2026-05-09-advisory-empty-state-pending-decisions-count-design.md`

---

## Pre-flight

### Task 0: Create worktree and branch

**Files:** none (git operations only)

- [ ] **Step 0.1: Verify clean working tree**

```bash
git status
```

Expected: `nothing to commit, working tree clean` (or only the spec/backlog/plan files just written, on `main`).

- [ ] **Step 0.2: Create worktree**

```bash
git worktree add -b feat/advisory-in-flight-projection ../nestfolio-advisory-in-flight main
cd ../nestfolio-advisory-in-flight
```

- [ ] **Step 0.3: Verify**

```bash
pwd
git status
git branch --show-current
```

Expected: `feat/advisory-in-flight-projection` branch on the new worktree path.

- [ ] **Step 0.4: Install deps in worktree**

```bash
pnpm install --frozen-lockfile
```

Expected: install completes without lockfile mismatch.

---

## Phase 1A — advisory-bff event types and transforms

### Task 1: Add `ADVISORY_STATUS_UPDATED` event type

**Files:**
- Modify: `services/advisory/advisory-bff/src/domain/events.ts`

- [ ] **Step 1.1: Read existing event types**

```bash
cat services/advisory/advisory-bff/src/domain/events.ts
```

Note current shape — `AdvisoryBffEventTypes` enum/object with branded `eventName(...)` values.

- [ ] **Step 1.2: Add the new entry**

Add `ADVISORY_STATUS_UPDATED: eventName('ADVISORY_STATUS_UPDATED'),` to `AdvisoryBffEventTypes`.

- [ ] **Step 1.3: Verify TypeScript compiles**

```bash
pnpm nx run advisory-bff:tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `events.ts`.

- [ ] **Step 1.4: Commit**

```bash
git add services/advisory/advisory-bff/src/domain/events.ts
git commit -m "feat(advisory-bff): add ADVISORY_STATUS_UPDATED event type"
```

---

### Task 2: Write `decision-trigger-received` transform (TDD)

**Files:**
- Create: `services/advisory/advisory-bff/src/transforms/decision-trigger-received.ts`
- Test: `services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts`

- [ ] **Step 2.1: Write the failing test**

Create `services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts`:

```ts
import { accumulate, update } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { decisionTriggerReceived } from '../../../src/transforms/decision-trigger-received';

type TestUow = UnitOfWork<BusEvent<{ tenantId: string }>>;

const TRIGGER_EVENTS = [
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
];

describe('decisionTriggerReceived transform', () => {
  const makeUow = (eventType: string): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: { tenantId: 't1' },
      context: { tenantId: 't1' },
    },
    payload: { tenantId: 't1' },
    record: {},
  }) as unknown as TestUow;

  TRIGGER_EVENTS.forEach((trigger) => {
    it(`returns +1 accumulate + lastTriggerAt update for ${trigger}`, () => {
      const intents = decisionTriggerReceived(makeUow(trigger));
      expect(intents).toEqual([
        accumulate('AdvisoryStatus', {
          field: 'inFlightCount',
          increment: 1,
          overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
        }),
        update('AdvisoryStatus', {
          lastTriggerAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }, { overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' } }),
      ]);
    });
  });
});
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-trigger-received'
```

Expected: FAIL — `Cannot find module '../../../src/transforms/decision-trigger-received'`.

- [ ] **Step 2.3: Write the minimal implementation**

Create `services/advisory/advisory-bff/src/transforms/decision-trigger-received.ts`:

```ts
import { accumulate, update, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

export const decisionTriggerReceived = (
  uow: UnitOfWork<BusEvent<{ tenantId: string }>>,
): WriteIntent[] => {
  const { tenantId } = uow.event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };
  return [
    accumulate('AdvisoryStatus', {
      field: 'inFlightCount',
      increment: 1,
      overrides,
    }),
    update('AdvisoryStatus', {
      lastTriggerAt: uow.event.timestamp,
      updatedAt: uow.event.timestamp,
    }, { overrides }),
  ];
};
```

- [ ] **Step 2.4: Run test to verify it passes**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-trigger-received'
```

Expected: PASS — 7 tests green.

- [ ] **Step 2.5: Commit**

```bash
git add services/advisory/advisory-bff/src/transforms/decision-trigger-received.ts services/advisory/advisory-bff/test/unit/transforms/decision-trigger-received.test.ts
git commit -m "feat(advisory-bff): add decision-trigger-received transform for inFlightCount"
```

---

### Task 3: Modify `decision-packet-created` transform to decrement counter (TDD)

**Files:**
- Modify: `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts`
- Modify: `services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts`

- [ ] **Step 3.1: Read existing test to understand shape**

```bash
cat services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts
```

- [ ] **Step 3.2: Update tests for new return shape**

Replace assertions that previously expected a single `WriteIntent` with array assertions. For the "happy path" test that asserts a populated packet writes a row, change to:

```ts
import { record, accumulate } from '@nestfolio/event-processor';

it('returns [record, accumulate(-1)] for populated packet', () => {
  const uow = makeUow({
    tenantId: 't1',
    decisionId: 'd1',
    trigger: 'DEPOSIT_DETECTED',
    proposedTrades: [{ symbol: 'AAPL', side: 'BUY', /* ... */ }],
    explanation: 'rationale',
    confirmationRequired: true,
  });
  const intents = decisionPacketCreated(uow);
  expect(intents).toEqual([
    record('DecisionReadModel', expect.objectContaining({
      tenantId: 't1',
      decisionId: 'd1',
      status: 'PENDING',
    }), {
      pk: 'Decision#t1#d1',
      sk: 'DecisionReadModel',
    }),
    accumulate('AdvisoryStatus', {
      field: 'inFlightCount',
      increment: -1,
      overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
    }),
  ]);
});

it('returns undefined when both explanation and trades are empty', () => {
  const uow = makeUow({
    tenantId: 't1',
    decisionId: 'd1',
    trigger: 'DEPOSIT_DETECTED',
    proposedTrades: [],
    explanation: '',
    confirmationRequired: false,
  });
  expect(decisionPacketCreated(uow)).toBeUndefined();
});
```

(Adapt the `makeUow` builder used in the existing test file — keep the existing harness.)

- [ ] **Step 3.3: Run test to verify it fails**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-packet-created'
```

Expected: FAIL — assertions on array don't match current `record(...)` single-intent return.

- [ ] **Step 3.4: Update the transform**

Replace `services/advisory/advisory-bff/src/transforms/decision-packet-created.ts` body:

```ts
import { record, accumulate, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

type DecisionPacketCreatedPayload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

// Defence-in-depth: skip DECISION_PACKET_CREATED events that carry neither
// explanation nor proposed trades. Post-Spec-2 the sole emitter is
// decision-workflow-ctrl's AssemblePacket (assemble-packet.ts:75-86), which
// always lands the row populated, so this skip should never fire in practice.
export const decisionPacketCreated = (
  uow: UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>,
): WriteIntent[] | undefined => {
  const { subject: p } = uow.event;
  const hasExplanation = typeof p.explanation === 'string' && p.explanation.length > 0;
  const hasTrades = Array.isArray(p.proposedTrades) && p.proposedTrades.length > 0;
  if (!hasExplanation && !hasTrades) return undefined;

  return [
    record('DecisionReadModel', {
      tenantId: p.tenantId,
      decisionId: p.decisionId,
      trigger: p.trigger,
      proposedTrades: p.proposedTrades,
      explanation: p.explanation,
      confirmationRequired: p.confirmationRequired,
      complianceChecks: [],
      agentInvocations: [],
      status: 'PENDING',
      version: 1,
      sourceEventId: uow.event.id,
      createdAt: uow.event.timestamp,
      updatedAt: uow.event.timestamp,
    }, {
      pk: `Decision#${p.tenantId}#${p.decisionId}`,
      sk: 'DecisionReadModel',
    }),
    accumulate('AdvisoryStatus', {
      field: 'inFlightCount',
      increment: -1,
      overrides: { pk: `T#${p.tenantId}`, sk: 'AdvisoryStatus' },
    }),
  ];
};
```

- [ ] **Step 3.5: Run test to verify it passes**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-packet-created'
```

Expected: PASS.

- [ ] **Step 3.6: Run full advisory-bff unit suite to catch regressions**

```bash
pnpm nx test advisory-bff
```

Expected: all tests pass.

- [ ] **Step 3.7: Commit**

```bash
git add services/advisory/advisory-bff/src/transforms/decision-packet-created.ts services/advisory/advisory-bff/test/unit/transforms/decision-packet-created.test.ts
git commit -m "feat(advisory-bff): decrement inFlightCount on DECISION_PACKET_CREATED"
```

---

### Task 4: Register `decisionTriggerReceived` in event-listener

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`

- [ ] **Step 4.1: Read existing handler**

```bash
cat services/advisory/advisory-bff/src/handlers/event-listener.ts
```

Identify the transform map (object keyed by event type → transform fn).

- [ ] **Step 4.2: Add 7 trigger event registrations**

At the top of the file, add:

```ts
import { decisionTriggerReceived } from '../transforms/decision-trigger-received';
import { TRIGGER_EVENT_TYPES } from '@nestfolio/decision-workflow-ctrl/events';
```

In the transform map, add an entry per trigger:

```ts
[TRIGGER_EVENT_TYPES[0]]: (payload: any, ctx: any) =>
  decisionTriggerReceived({ event: { type: TRIGGER_EVENT_TYPES[0], subject: payload, context: ctx, /* ... */ } }),
// Repeat per trigger, OR refactor to a loop:
...Object.fromEntries(
  TRIGGER_EVENT_TYPES.map((eventType) => [
    eventType,
    (payload: any, ctx: any) => decisionTriggerReceived({
      event: {
        id: ctx.eventId,
        type: eventType,
        timestamp: ctx.timestamp,
        subject: payload,
        context: ctx,
      },
      payload,
      record: {},
    } as any),
  ]),
),
```

(Adapt to the exact UnitOfWork shape used by the handler — read the existing entries for `DECISION_PACKET_CREATED` and mirror the construction.)

- [ ] **Step 4.3: Run handler unit tests**

```bash
pnpm nx test advisory-bff --testPathPatterns='event-listener'
```

Expected: existing tests still pass; if the handler test asserts the registered transform map shape, add cases for trigger events.

- [ ] **Step 4.4: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/event-listener.ts
git commit -m "feat(advisory-bff): register decisionTriggerReceived for 7 SF trigger events"
```

---

## Phase 1B — advisory-bff service stack and CDC publisher

### Task 5: Extend ingress subscriptions

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`

- [ ] **Step 5.1: Add the import**

At the top of `service.stack.ts`, add:

```ts
import { TRIGGER_EVENT_TYPES } from '@nestfolio/decision-workflow-ctrl/events';
```

- [ ] **Step 5.2: Extend the eventTypes array**

Modify the `Ingress` construction (currently lines 20-29) to:

```ts
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    DecisionWorkflowEventTypes.DECISION_PACKET_CREATED,
    DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED,
    ComplianceEventTypes.DECISION_APPROVED,
    ComplianceEventTypes.DECISION_BLOCKED,
    DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED,
    ...TRIGGER_EVENT_TYPES,
  ],
});
```

- [ ] **Step 5.3: Verify CDK synth**

```bash
pnpm nx run advisory-bff:cdk-synth 2>&1 | tail -20
```

Expected: synth succeeds; no missing event-type errors.

- [ ] **Step 5.4: Commit**

```bash
git add services/advisory/advisory-bff/src/service.stack.ts
git commit -m "feat(advisory-bff): subscribe to 7 SF trigger events"
```

---

### Task 6: Add `AdvisoryStatus` to Egress eventTypes

**Files:**
- Modify: `services/advisory/advisory-bff/src/service.stack.ts`

- [ ] **Step 6.1: Update Egress construction**

Modify the `Egress` block (currently lines 31-45) — add the `AdvisoryStatus` mapping:

```ts
const egress = new Egress(this, 'Egress', {
  state,
  eventTypes: {
    'DecisionReadModel': {
      insert: AdvisoryBffEventTypes.DECISION_READ_MODEL_CREATED,
      modify: AdvisoryBffEventTypes.DECISION_READ_MODEL_UPDATED,
    },
    'AdvisoryStatus': {
      insert: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
      modify: AdvisoryBffEventTypes.ADVISORY_STATUS_UPDATED,
    },
    'UserInteraction': {
      insert: AdvisoryBffEventTypes.USER_INTERACTION_CREATED,
      modify: AdvisoryBffEventTypes.USER_INTERACTION_UPDATED,
    },
    'UserConfirmation': { insert: AdvisoryBffEventTypes.USER_CONFIRMED },
    'UserRejection': { insert: AdvisoryBffEventTypes.USER_REJECTED },
  },
});
```

- [ ] **Step 6.2: Verify synth**

```bash
pnpm nx run advisory-bff:cdk-synth 2>&1 | tail -10
```

Expected: synth succeeds.

- [ ] **Step 6.3: Commit**

```bash
git add services/advisory/advisory-bff/src/service.stack.ts
git commit -m "feat(advisory-bff): emit ADVISORY_STATUS_UPDATED via CDC"
```

---

### Task 7: Update CDC publisher with `AdvisoryStatus` broadcast

**Files:**
- Modify: `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`
- Modify: `services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts`

- [ ] **Step 7.1: Add the failing test for AdvisoryStatus broadcast**

In `decision-publisher.test.ts`, add a new describe block:

```ts
describe('AdvisoryStatus broadcast', () => {
  it('publishes AdvisoryStatus changes via PUBLISH_ADVISORY_STATUS_UPDATE mutation', async () => {
    const mockAppSync = jest.fn().mockResolvedValue({ data: {} });
    // ... wire up the harness used in existing tests, see top of file
    const event = {
      Records: [
        {
          eventName: 'MODIFY',
          dynamodb: {
            NewImage: {
              pk: { S: 'T#tenant-1' },
              sk: { S: 'AdvisoryStatus' },
              __typename: { S: 'AdvisoryStatus' },
              inFlightCount: { N: '2' },
              lastTriggerAt: { S: '2026-05-09T10:00:00.000Z' },
              updatedAt: { S: '2026-05-09T10:00:00.000Z' },
            },
            OldImage: {
              pk: { S: 'T#tenant-1' },
              sk: { S: 'AdvisoryStatus' },
              __typename: { S: 'AdvisoryStatus' },
              inFlightCount: { N: '1' },
              lastTriggerAt: { S: '2026-05-09T09:59:00.000Z' },
              updatedAt: { S: '2026-05-09T09:59:00.000Z' },
            },
          },
        },
      ],
    };
    await handler(event as any, /* mock ctx */);
    expect(mockAppSync).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.stringContaining('publishAdvisoryStatusUpdate'),
        variables: {
          tenantId: 'tenant-1',
          inFlightCount: 2,
          lastTriggerAt: '2026-05-09T10:00:00.000Z',
          updatedAt: '2026-05-09T10:00:00.000Z',
        },
      }),
    );
  });
});
```

(Adapt the harness setup to match the existing `decision-publisher.test.ts` mocking pattern — read the file first to mirror its style.)

- [ ] **Step 7.2: Run test to verify it fails**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-publisher'
```

Expected: FAIL — broadcast for `AdvisoryStatus` not registered.

- [ ] **Step 7.3: Add the broadcast**

Modify `services/advisory/advisory-bff/src/handlers/decision-publisher.ts`. Add the new mutation constant near the existing `PUBLISH_DECISION_UPDATE`:

```ts
const PUBLISH_ADVISORY_STATUS_UPDATE = `
  mutation PublishAdvisoryStatusUpdate(
    $tenantId: ID!
    $inFlightCount: Int!
    $lastTriggerAt: String
    $updatedAt: String!
  ) {
    publishAdvisoryStatusUpdate(
      tenantId: $tenantId
      inFlightCount: $inFlightCount
      lastTriggerAt: $lastTriggerAt
      updatedAt: $updatedAt
    ) {
      tenantId
      inFlightCount
      lastTriggerAt
      updatedAt
    }
  }
`;

const extractTenantFromPk = (pk: string): string => pk.startsWith('T#') ? pk.slice(2) : pk;
```

In the `broadcasts:` map, add an entry next to `DecisionReadModel`:

```ts
broadcasts: {
  DecisionReadModel: { /* existing — keep as-is */ },
  AdvisoryStatus: {
    mutation: PUBLISH_ADVISORY_STATUS_UPDATE,
    whenChanged: ['inFlightCount', 'lastTriggerAt'],
    mapImage: (item) => ({
      tenantId: extractTenantFromPk(String(item['pk'] ?? '')),
      inFlightCount: Number(item['inFlightCount'] ?? 0),
      lastTriggerAt: typeof item['lastTriggerAt'] === 'string' ? item['lastTriggerAt'] : null,
      updatedAt: String(item['updatedAt'] ?? new Date().toISOString()),
    }),
  },
},
```

- [ ] **Step 7.4: Run test to verify it passes**

```bash
pnpm nx test advisory-bff --testPathPatterns='decision-publisher'
```

Expected: PASS.

- [ ] **Step 7.5: Commit**

```bash
git add services/advisory/advisory-bff/src/handlers/decision-publisher.ts services/advisory/advisory-bff/test/unit/handlers/decision-publisher.test.ts
git commit -m "feat(advisory-bff): broadcast AdvisoryStatus changes via publishAdvisoryStatusUpdate"
```

---

## Phase 1C — advisory-bff GraphQL surface

### Task 8: Update `schema.graphql`

**Files:**
- Modify: `services/advisory/advisory-bff/src/schema.graphql`

- [ ] **Step 8.1: Add `AdvisoryStatus` type**

Append after the existing `DecisionConnection` type (or in the type-definitions block near line 122):

```graphql
type AdvisoryStatus @aws_cognito_user_pools @aws_iam {
  tenantId: ID!
  inFlightCount: Int!
  lastTriggerAt: String
  updatedAt: String!
}
```

- [ ] **Step 8.2: Add `getAdvisoryStatus` query**

Inside the `type Query` block (lines 1-7), add a new field:

```graphql
type Query {
  getDecision(decisionId: ID!): DecisionPacket
  getPendingDecisions(limit: Int, cursor: String): DecisionConnection!
  getDecisionHistory(limit: Int, cursor: String): DecisionConnection!
  getAgentInvocations(decisionId: ID!): [AgentInvocation!]!
  getComplianceChecks(decisionId: ID!): [ComplianceCheck!]!
  getAdvisoryStatus: AdvisoryStatus
}
```

- [ ] **Step 8.3: Add `publishAdvisoryStatusUpdate` mutation**

Inside the `type Mutation` block, add at the end:

```graphql
publishAdvisoryStatusUpdate(
  tenantId: ID!
  inFlightCount: Int!
  lastTriggerAt: String
  updatedAt: String!
): AdvisoryStatus! @aws_iam
```

- [ ] **Step 8.4: Add `onAdvisoryStatusUpdate` subscription**

Inside the `type Subscription` block, add:

```graphql
onAdvisoryStatusUpdate(tenantId: ID!): AdvisoryStatus
  @aws_subscribe(mutations: ["publishAdvisoryStatusUpdate"])
  @aws_cognito_user_pools
  @aws_iam
```

(Note: subscription return type is **nullable** per the existing pattern documented at `schema.graphql:30-38`. Do NOT add `!`.)

- [ ] **Step 8.5: Verify schema validates via cdk synth**

```bash
pnpm nx run advisory-bff:cdk-synth 2>&1 | tail -20
```

Expected: synth succeeds; no schema validation errors.

- [ ] **Step 8.6: Commit**

```bash
git add services/advisory/advisory-bff/src/schema.graphql
git commit -m "feat(advisory-bff): add AdvisoryStatus type, query, mutation, subscription to schema"
```

---

### Task 9: Add `Query.getAdvisoryStatus` JS resolver

**Files:**
- Create: `services/advisory/advisory-bff/src/graphql/js-function/Query.getAdvisoryStatus.req.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/Query.getAdvisoryStatus.res.js`

- [ ] **Step 9.1: Look at an existing single-item Get resolver to mirror its shape**

```bash
ls services/advisory/advisory-bff/src/graphql/js-function/
cat services/advisory/advisory-bff/src/graphql/js-function/Query.getDecision.req.js
cat services/advisory/advisory-bff/src/graphql/js-function/Query.getDecision.res.js
```

- [ ] **Step 9.2: Write `Query.getAdvisoryStatus.req.js`**

Create:

```js
import { util } from '@aws-appsync/utils';

export function request(ctx) {
  const tenantId = ctx.identity?.claims?.['custom:tenant_id'];
  if (!tenantId) {
    util.unauthorized();
  }
  return {
    operation: 'GetItem',
    key: util.dynamodb.toMapValues({
      pk: `T#${tenantId}`,
      sk: 'AdvisoryStatus',
    }),
  };
}

export function response(ctx) {
  if (ctx.error) {
    util.appendError(ctx.error.message, ctx.error.type);
  }
  if (!ctx.result) return null;
  return {
    tenantId: ctx.result.pk?.startsWith('T#') ? ctx.result.pk.slice(2) : ctx.result.pk,
    inFlightCount: ctx.result.inFlightCount ?? 0,
    lastTriggerAt: ctx.result.lastTriggerAt ?? null,
    updatedAt: ctx.result.updatedAt,
  };
}
```

(If the project convention splits `request` and `response` into two files — `req.js` and `res.js` — use that split. Mirror `Query.getDecision.*` exactly.)

- [ ] **Step 9.3: Verify synth**

```bash
pnpm nx run advisory-bff:cdk-synth 2>&1 | tail -10
```

Expected: synth picks up the new resolver via `discoverJsResolvers`.

- [ ] **Step 9.4: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/Query.getAdvisoryStatus.*
git commit -m "feat(advisory-bff): add getAdvisoryStatus JS resolver"
```

---

### Task 10: Add `Mutation.publishAdvisoryStatusUpdate` JS resolver

**Files:**
- Create: `services/advisory/advisory-bff/src/graphql/js-function/Mutation.publishAdvisoryStatusUpdate.req.js`
- Create: `services/advisory/advisory-bff/src/graphql/js-function/Mutation.publishAdvisoryStatusUpdate.res.js`

- [ ] **Step 10.1: Look at the existing `publishDecisionUpdate` resolver as a reference**

```bash
cat services/advisory/advisory-bff/src/graphql/js-function/Mutation.publishDecisionUpdate.req.js
cat services/advisory/advisory-bff/src/graphql/js-function/Mutation.publishDecisionUpdate.res.js
```

- [ ] **Step 10.2: Write the request resolver**

```js
// Mutation.publishAdvisoryStatusUpdate.req.js
export function request(ctx) {
  // NONE data source — pass-through; the side effect is the @aws_subscribe broadcast
  return {};
}

export function response(ctx) {
  return ctx.args;
}
```

(Match exactly the layout of `publishDecisionUpdate.*` resolvers.)

- [ ] **Step 10.3: Add to `noneDataSource` list in service.stack.ts**

Edit `services/advisory/advisory-bff/src/service.stack.ts:52`:

```ts
noneDataSource: ['publishDecisionUpdate', 'publishAdvisoryStatusUpdate'],
```

- [ ] **Step 10.4: Verify synth**

```bash
pnpm nx run advisory-bff:cdk-synth 2>&1 | tail -10
```

Expected: synth wires up the resolver; no validation errors.

- [ ] **Step 10.5: Commit**

```bash
git add services/advisory/advisory-bff/src/graphql/js-function/Mutation.publishAdvisoryStatusUpdate.* services/advisory/advisory-bff/src/service.stack.ts
git commit -m "feat(advisory-bff): add publishAdvisoryStatusUpdate IAM mutation resolver"
```

---

## Phase 1D — advisory-bff integration tests

### Task 11: Integration tests for in-flight projection

**Files:**
- Modify: `services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts`

- [ ] **Step 11.1: Read existing integration tests**

```bash
cat services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts | head -100
```

Identify the harness — likely uses `@nestfolio/test-support` fixtures (FreshTenant, EventBus emitter, BFF client).

- [ ] **Step 11.2: Add new describe block**

Add at the bottom of the existing test file:

```ts
describe('AdvisoryStatus in-flight projection', () => {
  it('emits a trigger → AdvisoryStatus row inFlightCount=1', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, {
      type: 'DEPOSIT_DETECTED',
      subject: { tenantId: tenant.tenantId, amountCents: 10_000 },
    });
    await waitFor(async () => {
      const row = await advisoryRepo.getAdvisoryStatus(tenant.tenantId);
      expect(row).toBeDefined();
      expect(row?.inFlightCount).toBe(1);
    }, { timeoutMs: 30_000 });
  });

  it('trigger then DECISION_PACKET_CREATED → counter back to 0, DecisionReadModel exists', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, { type: 'DEPOSIT_DETECTED', subject: { tenantId: tenant.tenantId } });
    const decisionId = `d-${Date.now()}`;
    await eventBus.emit(tenant, {
      type: 'DECISION_PACKET_CREATED',
      subject: {
        tenantId: tenant.tenantId,
        decisionId,
        trigger: 'DEPOSIT_DETECTED',
        proposedTrades: [{ symbol: 'AAPL', side: 'BUY', /* ... */ }],
        explanation: 'rationale',
        confirmationRequired: true,
      },
    });
    await waitFor(async () => {
      const status = await advisoryRepo.getAdvisoryStatus(tenant.tenantId);
      expect(status?.inFlightCount).toBe(0);
      const decision = await advisoryRepo.getDecisionReadModel(tenant.tenantId, decisionId);
      expect(decision).toBeDefined();
    }, { timeoutMs: 30_000 });
  });

  it('two triggers + one PACKET → counter=1', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, { type: 'DEPOSIT_DETECTED', subject: { tenantId: tenant.tenantId } });
    await eventBus.emit(tenant, { type: 'ORDER_FILLED', subject: { tenantId: tenant.tenantId } });
    await eventBus.emit(tenant, {
      type: 'DECISION_PACKET_CREATED',
      subject: {
        tenantId: tenant.tenantId,
        decisionId: `d-${Date.now()}`,
        trigger: 'DEPOSIT_DETECTED',
        proposedTrades: [{ symbol: 'AAPL' }],
        explanation: 'r',
        confirmationRequired: false,
      },
    });
    await waitFor(async () => {
      const status = await advisoryRepo.getAdvisoryStatus(tenant.tenantId);
      expect(status?.inFlightCount).toBe(1);
    }, { timeoutMs: 30_000 });
  });
});
```

(`advisoryRepo` may need a new `getAdvisoryStatus` repo method — add it if missing in `services/advisory/advisory-bff/src/repositories/advisory.repository.ts`. Mirror the existing single-item Get pattern.)

- [ ] **Step 11.3: Add repository method (if needed)**

In `services/advisory/advisory-bff/src/repositories/advisory.repository.ts`, add:

```ts
async getAdvisoryStatus(tenantId: string): Promise<AdvisoryStatusRow | null> {
  const result = await this.client.send(new GetItemCommand({
    TableName: this.tableName,
    Key: marshall({ pk: `T#${tenantId}`, sk: 'AdvisoryStatus' }),
  }));
  if (!result.Item) return null;
  const item = unmarshall(result.Item);
  return {
    tenantId,
    inFlightCount: Number(item['inFlightCount'] ?? 0),
    lastTriggerAt: typeof item['lastTriggerAt'] === 'string' ? item['lastTriggerAt'] : null,
    updatedAt: String(item['updatedAt'] ?? ''),
  };
}
```

(Adapt to the actual repository class's existing patterns — read the file first.)

- [ ] **Step 11.4: Run integration tests against deployed dev**

The advisory-bff service must be deployed first — defer to Task 27 (validation gate). For now, run the tests if the dev environment already has compatible code, else mark them pending.

- [ ] **Step 11.5: Commit**

```bash
git add services/advisory/advisory-bff/test/integration/advisory-bff.integration.test.ts services/advisory/advisory-bff/src/repositories/advisory.repository.ts
git commit -m "test(advisory-bff): integration tests for in-flight projection"
```

---

## Phase 1E — advisory-mfe frontend

### Task 12: Add i18n keys

**Files:**
- Modify: `libs/shell/src/i18n/assets/en-GB.json`
- Modify: `libs/shell/src/i18n/assets/it-IT.json`

- [ ] **Step 12.1: Add 3 keys to en-GB.json**

Inside the `advisory.list` object (around line 135-140 of `libs/shell/src/i18n/assets/en-GB.json`), add:

```json
"advisory": {
  "list": {
    "title": "Pending Decisions",
    "emptyTitle": "No pending decisions",
    "emptyHint": "New advisory recommendations will appear here.",
    "errorTitle": "Could not load decisions",
    "generatingTitle": "Agent is generating recommendations…",
    "generatingHint": "This usually takes 30 to 75 seconds. The list will refresh automatically.",
    "generatingMore": "Generating {count} additional recommendation(s)…"
  }
}
```

- [ ] **Step 12.2: Add 3 keys to it-IT.json**

Inside the `advisory.list` object (around line 135-140), add:

```json
"generatingTitle": "L'agente sta generando raccomandazioni…",
"generatingHint": "Di solito richiede da 30 a 75 secondi. La lista si aggiornerà automaticamente.",
"generatingMore": "Generando {count} raccomandazione(i) aggiuntiva(e)…"
```

- [ ] **Step 12.3: Commit**

```bash
git add libs/shell/src/i18n/assets/en-GB.json libs/shell/src/i18n/assets/it-IT.json
git commit -m "feat(shell-i18n): add advisory.list.generating* keys"
```

---

### Task 13: Extend `AdvisoryService` with status query + subscription

**Files:**
- Modify: `apps/advisory-mfe/src/app/services/advisory.service.ts`

- [ ] **Step 13.1: Read existing service to identify GraphQL client conventions**

```bash
cat apps/advisory-mfe/src/app/services/advisory.service.ts
```

Note imports: Apollo client, Cognito auth, subscription helper.

- [ ] **Step 13.2: Add the AdvisoryStatusSnapshot type**

Near the top of the file, alongside `PendingDecisionListItem`:

```ts
export interface AdvisoryStatusSnapshot {
  tenantId: string;
  inFlightCount: number;
  lastTriggerAt: string | null;
  updatedAt: string;
}
```

- [ ] **Step 13.3: Add the GraphQL operations**

```ts
const GET_ADVISORY_STATUS = `
  query GetAdvisoryStatus {
    getAdvisoryStatus {
      tenantId
      inFlightCount
      lastTriggerAt
      updatedAt
    }
  }
`;

const ON_ADVISORY_STATUS_UPDATE = `
  subscription OnAdvisoryStatusUpdate($tenantId: ID!) {
    onAdvisoryStatusUpdate(tenantId: $tenantId) {
      tenantId
      inFlightCount
      lastTriggerAt
      updatedAt
    }
  }
`;
```

- [ ] **Step 13.4: Add service methods**

In the `AdvisoryService` class:

```ts
async getAdvisoryStatus(): Promise<AdvisoryStatusSnapshot | null> {
  const result = await this.apollo.query<{ getAdvisoryStatus: AdvisoryStatusSnapshot | null }>({
    query: gql(GET_ADVISORY_STATUS),
    fetchPolicy: 'network-only',
  }).toPromise();
  return result?.data.getAdvisoryStatus ?? null;
}

private statusSubscription: { unsubscribe: () => void } | null = null;

subscribeToAdvisoryStatusUpdates(
  tenantId: string,
  onFrame: (snapshot: AdvisoryStatusSnapshot) => void,
): void {
  this.statusSubscription = this.apollo.subscribe<{ onAdvisoryStatusUpdate: AdvisoryStatusSnapshot | null }>({
    query: gql(ON_ADVISORY_STATUS_UPDATE),
    variables: { tenantId },
  }).subscribe(({ data }) => {
    if (data?.onAdvisoryStatusUpdate) onFrame(data.onAdvisoryStatusUpdate);
  });
}

unsubscribeFromAdvisoryStatusUpdates(): void {
  this.statusSubscription?.unsubscribe();
  this.statusSubscription = null;
}
```

(Match the existing pattern in `subscribeToDecisionListUpdates` — same Apollo client, same auth.)

- [ ] **Step 13.5: Verify TS compile**

```bash
pnpm nx run advisory-mfe:tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 13.6: Commit**

```bash
git add apps/advisory-mfe/src/app/services/advisory.service.ts
git commit -m "feat(advisory-mfe): add getAdvisoryStatus + onAdvisoryStatusUpdate to AdvisoryService"
```

---

### Task 14: Update `DecisionListComponent` signals and ngOnInit

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts`

- [ ] **Step 14.1: Add new signals**

Below the existing `error` signal (around line 132), add:

```ts
readonly inFlightCount = signal<number>(0);
readonly lastTriggerAt = signal<string | null>(null);

private static readonly STALENESS_MS = 5 * 60 * 1000;

readonly displayedInFlightCount = computed(() => {
  const c = this.inFlightCount();
  if (c <= 0) return 0;
  const last = this.lastTriggerAt();
  if (!last) return 0;
  const ageMs = Date.now() - new Date(last).getTime();
  return ageMs < DecisionListComponent.STALENESS_MS ? c : 0;
});
```

Import `computed` from `@angular/core` if not already imported.

- [ ] **Step 14.2: Update ngOnInit**

Replace the body of `ngOnInit` (lines 146-168) with:

```ts
async ngOnInit(): Promise<void> {
  this.loading.set(true);
  this.error.set(null);

  const tenantId = this.authStore.user()?.tenantId;
  if (tenantId) {
    // Pattern B (R1): subscriptions BEFORE the queries fire so frames
    // delivered during query resolution are not lost.
    this.advisoryService.subscribeToDecisionListUpdates(tenantId, (frame) =>
      this.reconcile(frame),
    );
    this.advisoryService.subscribeToAdvisoryStatusUpdates(tenantId, (snapshot) => {
      this.inFlightCount.set(snapshot.inFlightCount);
      this.lastTriggerAt.set(snapshot.lastTriggerAt);
    });
  }

  try {
    const [items, status] = await Promise.all([
      this.advisoryService.getPendingDecisions(),
      this.advisoryService.getAdvisoryStatus(),
    ]);
    this.decisions.set(items);
    if (status) {
      this.inFlightCount.set(status.inFlightCount);
      this.lastTriggerAt.set(status.lastTriggerAt);
    }
    this.loaded.set(true);
  } catch (e: unknown) {
    this.error.set(parseError(e, 'errors.decision'));
  } finally {
    this.loading.set(false);
  }
}
```

- [ ] **Step 14.3: Update ngOnDestroy**

```ts
ngOnDestroy(): void {
  this.advisoryService.unsubscribeFromDecisionListUpdates();
  this.advisoryService.unsubscribeFromAdvisoryStatusUpdates();
}
```

- [ ] **Step 14.4: Verify compile**

```bash
pnpm nx run advisory-mfe:tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 14.5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts
git commit -m "feat(advisory-mfe): wire inFlightCount + lastTriggerAt signals + subscription"
```

---

### Task 15: Update `DecisionListComponent` template

**Files:**
- Modify: `apps/advisory-mfe/src/app/decision-list/decision-list.component.ts`

- [ ] **Step 15.1: Replace template branches**

Replace the `template:` block (lines 27-67) with the 5-branch state machine:

```ts
template: `
  @if (loading() && !loaded()) {
    <nf-loading-skeleton [count]="5" />
  } @else if (error()) {
    <nf-empty-state
      icon="pi pi-exclamation-triangle"
      [title]="i18n.t('advisory.list.errorTitle')"
      [message]="i18n.t(error()!)"
    />
  } @else if (decisions().length > 0) {
    <div class="decision-list" data-testid="advisory-decision-list">
      <h2 class="list-title">{{ i18n.t('advisory.list.title') }}</h2>
      @if (displayedInFlightCount() > 0) {
        <div class="generating-banner" data-testid="advisory-generating-banner">
          <span class="pi pi-spin pi-spinner"></span>
          {{ i18n.t('advisory.list.generatingMore', { count: displayedInFlightCount() }) }}
        </div>
      }
      <ul class="items">
        @for (d of decisions(); track d.decisionId) {
          <li class="item">
            <a
              class="item-link"
              [routerLink]="['/advisory', d.decisionId]"
              [attr.data-testid]="'decision-' + d.decisionId"
            >
              <div class="item-row">
                <span class="item-trigger">{{ d.trigger }}</span>
                <nf-status-badge
                  [label]="d.status"
                  [severity]="statusSeverity(d.status)"
                />
              </div>
              <span class="item-date">{{ d.createdAt | date: 'short' }}</span>
            </a>
          </li>
        }
      </ul>
    </div>
  } @else if (displayedInFlightCount() > 0) {
    <nf-empty-state
      icon="pi pi-spin pi-spinner"
      [title]="i18n.t('advisory.list.generatingTitle')"
      [message]="i18n.t('advisory.list.generatingHint')"
      data-testid="advisory-generating-state"
    />
  } @else {
    <nf-empty-state
      icon="pi pi-chart-line"
      [title]="i18n.t('advisory.list.emptyTitle')"
      [message]="i18n.t('advisory.list.emptyHint')"
    />
  }
`,
```

- [ ] **Step 15.2: Add styles for the generating banner**

In the `styles:` block (lines 68-122), add:

```css
.generating-banner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  margin-bottom: 0.5rem;
  background: var(--p-surface-50);
  border: 1px dashed var(--p-primary-300);
  border-radius: 0.375rem;
  font-size: 0.875rem;
  color: var(--p-surface-700);
}
.generating-banner .pi-spinner {
  color: var(--p-primary-500);
}
```

- [ ] **Step 15.3: Confirm `nf-empty-state` accepts `data-testid` and a custom icon class**

```bash
grep -n "data-testid\|@Input.*icon" libs/ui/src/lib/empty-state/empty-state.component.ts
```

If `data-testid` is not pass-through, add it as an input on `EmptyStateComponent`. If `icon` accepts arbitrary class, the `pi-spin pi-spinner` combination should render correctly. Otherwise add a `[class.spinning]="true"` input.

- [ ] **Step 15.4: Build the MFE**

```bash
pnpm nx build advisory-mfe 2>&1 | tail -20
```

Expected: build succeeds.

- [ ] **Step 15.5: Commit**

```bash
git add apps/advisory-mfe/src/app/decision-list/decision-list.component.ts libs/ui/src/lib/empty-state/empty-state.component.ts
git commit -m "feat(advisory-mfe): render generating state when inFlightCount > 0"
```

---

## Phase 2A — investor-adpt forwarding

### Task 16: Add `PORTFOLIO_DRIFT_DETECTED` to `InvestorIngestEventTypes`

**Files:**
- Modify: `services/investor/investor-adpt/src/domain/events.ts`

- [ ] **Step 16.1: Add the entry**

Add `PORTFOLIO_DRIFT_DETECTED: eventName('PORTFOLIO_DRIFT_DETECTED'),` to `InvestorIngestEventTypes`.

- [ ] **Step 16.2: Verify TS compile**

```bash
pnpm nx run investor-adpt:tsc --noEmit 2>&1 | head -10
```

Expected: no errors.

- [ ] **Step 16.3: Commit**

```bash
git add services/investor/investor-adpt/src/domain/events.ts
git commit -m "feat(investor-adpt): add PORTFOLIO_DRIFT_DETECTED to InvestorIngestEventTypes"
```

---

### Task 17: Forward `PORTFOLIO_DRIFT_DETECTED` from ledgerBus to investorBus

**Files:**
- Modify: `services/investor/investor-adpt/src/service.stack.ts`

- [ ] **Step 17.1: Edit `fromLedgerEvents`**

In `service.stack.ts:95-101`, add `InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED` to the array:

```ts
const fromLedgerEvents = [
  InvestorIngestEventTypes.BALANCE_UPDATED,
  InvestorIngestEventTypes.PORTFOLIO_UPDATED,
  InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
  InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
  InvestorIngestEventTypes.LEDGER_PROCESSING_FAILED,
  InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
];
```

The `$or` source-filter override (line 107-111) auto-picks up the new entry.

- [ ] **Step 17.2: Verify synth**

```bash
pnpm nx run investor-adpt:cdk-synth 2>&1 | tail -10
```

Expected: synth succeeds.

- [ ] **Step 17.3: Commit**

```bash
git add services/investor/investor-adpt/src/service.stack.ts
git commit -m "feat(investor-adpt): forward PORTFOLIO_DRIFT_DETECTED ledger→investor"
```

---

### Task 18: Integration test for ledger forwarding

**Files:**
- Modify: `services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts`

- [ ] **Step 18.1: Read existing forwarding test**

```bash
cat services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts
```

Identify the harness — likely emits to ledgerBus, listens on investorBus.

- [ ] **Step 18.2: Add a test case for PORTFOLIO_DRIFT_DETECTED**

Append:

```ts
it('forwards PORTFOLIO_DRIFT_DETECTED from ledger → investor bus', async () => {
  const tenant = await tenantFixture.fresh();
  await ledgerBus.emit(tenant, {
    type: 'PORTFOLIO_DRIFT_DETECTED',
    subject: { tenantId: tenant.tenantId, driftPercent: 5.2 },
  });
  await waitFor(async () => {
    const seen = await investorBusInbox.find(tenant, 'PORTFOLIO_DRIFT_DETECTED');
    expect(seen).toBeDefined();
  }, { timeoutMs: 30_000 });
});
```

(Adapt the helpers — `ledgerBus.emit`, `investorBusInbox.find` — to match the existing test's patterns.)

- [ ] **Step 18.3: Commit (test will be run in validation gate)**

```bash
git add services/investor/investor-adpt/test/integration/from-ledger.integration.test.ts
git commit -m "test(investor-adpt): integration test for PORTFOLIO_DRIFT_DETECTED forwarding"
```

---

## Phase 2B — dashboard-bff in-flight projection

### Task 19: Rewrite `advisory-status.ts` transform (TDD)

**Files:**
- Modify: `services/investor/dashboard-bff/src/transforms/advisory-status.ts`
- Modify: `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts`

- [ ] **Step 19.1: Replace tests**

Replace `services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts` body:

```ts
import { accumulate } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { advisoryStatus } from '../../../src/transforms/advisory-status';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

const TRIGGER_EVENTS = [
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
];

describe('advisoryStatus transform (post-Phase-2)', () => {
  const makeUow = (eventType: string): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject: {},
      context: { tenantId: 't1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  TRIGGER_EVENTS.forEach((trigger) => {
    it(`increments pendingDecisionsCount on ${trigger}`, () => {
      expect(advisoryStatus(makeUow(trigger))).toEqual(
        accumulate('AdvisoryStatus', {
          field: 'pendingDecisionsCount',
          increment: 1,
          overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
        }),
      );
    });
  });

  it('decrements on DECISION_APPROVED', () => {
    expect(advisoryStatus(makeUow('DECISION_APPROVED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisionsCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('decrements on DECISION_BLOCKED', () => {
    expect(advisoryStatus(makeUow('DECISION_BLOCKED'))).toEqual(
      accumulate('AdvisoryStatus', {
        field: 'pendingDecisionsCount',
        increment: -1,
        overrides: { pk: 'T#t1', sk: 'AdvisoryStatus' },
      }),
    );
  });

  it('does NOT increment on DECISION_PACKET_CREATED (replaced by trigger increment)', () => {
    expect(advisoryStatus(makeUow('DECISION_PACKET_CREATED'))).toBeUndefined();
  });

  it('does NOT increment on USER_CONFIRMATION_REQUESTED (was double-count)', () => {
    expect(advisoryStatus(makeUow('USER_CONFIRMATION_REQUESTED'))).toBeUndefined();
  });

  it('returns undefined for unknown event types', () => {
    expect(advisoryStatus(makeUow('UNKNOWN'))).toBeUndefined();
  });
});
```

- [ ] **Step 19.2: Run tests to verify failures**

```bash
pnpm nx test dashboard-bff --testPathPatterns='advisory-status'
```

Expected: FAIL on the new trigger-event cases AND on the "no longer increments" cases.

- [ ] **Step 19.3: Rewrite the transform**

Replace `services/investor/dashboard-bff/src/transforms/advisory-status.ts`:

```ts
import { accumulate, type WriteIntent } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';

const TRIGGER_TYPES = new Set<string>([
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
  'DEPOSIT_DETECTED',
]);

export const advisoryStatus = (
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): WriteIntent | undefined => {
  const { event } = uow;
  const { tenantId } = event.context;
  const overrides = { pk: `T#${tenantId}`, sk: 'AdvisoryStatus' };

  if (TRIGGER_TYPES.has(event.type)) {
    return accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: 1, overrides });
  }

  switch (event.type) {
    case 'DECISION_APPROVED':
    case 'DECISION_BLOCKED':
      return accumulate('AdvisoryStatus', { field: 'pendingDecisionsCount', increment: -1, overrides });
    default:
      return undefined;
  }
};
```

- [ ] **Step 19.4: Run tests to verify pass**

```bash
pnpm nx test dashboard-bff --testPathPatterns='advisory-status'
```

Expected: PASS.

- [ ] **Step 19.5: Commit**

```bash
git add services/investor/dashboard-bff/src/transforms/advisory-status.ts services/investor/dashboard-bff/test/unit/transforms/advisory-status.test.ts
git commit -m "refactor(dashboard-bff): pendingDecisionsCount = trigger-driven + APPROVED/BLOCKED -1"
```

---

### Task 20: Extend dashboard-bff ingress subscriptions

**Files:**
- Modify: `services/investor/dashboard-bff/src/service.stack.ts`

- [ ] **Step 20.1: Add 4 new event subscriptions**

In `service.stack.ts:27-43`, extend the eventTypes:

```ts
const ingress = new Ingress(this, 'Ingress', {
  state,
  eventTypes: [
    InvestorIngestEventTypes.BALANCE_UPDATED,
    InvestorIngestEventTypes.PORTFOLIO_UPDATED,
    InvestorIngestEventTypes.RECONCILIATION_COMPLETED,
    InvestorIngestEventTypes.DECISION_PACKET_CREATED,
    InvestorIngestEventTypes.USER_CONFIRMATION_REQUESTED,
    InvestorIngestEventTypes.DECISION_APPROVED,
    InvestorIngestEventTypes.DECISION_BLOCKED,
    InvestorIngestEventTypes.LEDGER_ENTRY_RECORDED,
    InvestorBffEventTypes.INVESTOR_PROFILE_CREATED,
    InvestorBffEventTypes.INVESTOR_PROFILE_UPDATED,
    InvestorIngestEventTypes.DEPOSIT_DETECTED,
    InvestorIngestEventTypes.WITHDRAWAL_COMPLETED,
    // Phase 2 — additional triggers for in-flight projection
    InvestorIngestEventTypes.ORDER_FILLED,
    InvestorIngestEventTypes.ORDER_REJECTED,
    InvestorIngestEventTypes.ORDER_CANCELLED,
    InvestorIngestEventTypes.PORTFOLIO_DRIFT_DETECTED,
  ],
});
```

(`DECISION_PACKET_CREATED` and `USER_CONFIRMATION_REQUESTED` remain subscribed because other transforms — `recent-activity`, `last-decision-status` updates — still depend on them. Only the `advisory-status` transform changes its handling.)

- [ ] **Step 20.2: Verify CDK synth**

```bash
pnpm nx run dashboard-bff:cdk-synth 2>&1 | tail -10
```

Expected: synth succeeds.

- [ ] **Step 20.3: Commit**

```bash
git add services/investor/dashboard-bff/src/service.stack.ts
git commit -m "feat(dashboard-bff): subscribe to ORDER_*, PORTFOLIO_DRIFT_DETECTED for in-flight projection"
```

---

### Task 21: Register transform for new event types in event-listener

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`

- [ ] **Step 21.1: Read existing handler**

```bash
cat services/investor/dashboard-bff/src/handlers/event-listener.ts
```

Identify the dispatch map.

- [ ] **Step 21.2: Add 4 new event-type dispatch entries**

Map each of `ORDER_FILLED`, `ORDER_REJECTED`, `ORDER_CANCELLED`, `PORTFOLIO_DRIFT_DETECTED` to the existing `advisoryStatus` transform. Mirror the registration pattern of `DEPOSIT_DETECTED` (already on the list — examine it as a reference).

Example sketch (adapt to actual handler signature):

```ts
const TRIGGER_FOR_ADVISORY_STATUS = [
  'DEPOSIT_DETECTED',
  'INVESTOR_PROFILE_CREATED',
  'INVESTOR_PROFILE_UPDATED',
  'PORTFOLIO_DRIFT_DETECTED',
  'ORDER_FILLED',
  'ORDER_REJECTED',
  'ORDER_CANCELLED',
];
// In the dispatch map:
...Object.fromEntries(TRIGGER_FOR_ADVISORY_STATUS.map((t) => [t, advisoryStatusHandler])),
```

- [ ] **Step 21.3: Run handler unit tests**

```bash
pnpm nx test dashboard-bff --testPathPatterns='event-listener'
```

Expected: existing tests pass; if the test asserts the registered map, extend its expected list.

- [ ] **Step 21.4: Commit**

```bash
git add services/investor/dashboard-bff/src/handlers/event-listener.ts services/investor/dashboard-bff/test/unit/handlers/event-listener.test.ts
git commit -m "feat(dashboard-bff): dispatch ORDER_* + PORTFOLIO_DRIFT_DETECTED to advisoryStatus transform"
```

---

### Task 22: Integration test for dashboard-bff trigger-driven counter

**Files:**
- Modify: `services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts`

- [ ] **Step 22.1: Add scenarios**

Append:

```ts
describe('AdvisoryStatus pendingDecisionsCount (Phase 2)', () => {
  it('increments pendingDecisionsCount on DEPOSIT_DETECTED (trigger)', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, { type: 'DEPOSIT_DETECTED', subject: { tenantId: tenant.tenantId } });
    await waitFor(async () => {
      const dashboard = await dashboardRepo.getDashboard(tenant.tenantId);
      expect(dashboard?.advisoryStatus?.pendingDecisionsCount).toBe(1);
    }, { timeoutMs: 30_000 });
  });

  it('decrements on DECISION_APPROVED', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, { type: 'DEPOSIT_DETECTED', subject: { tenantId: tenant.tenantId } });
    await waitFor(async () => {
      const d = await dashboardRepo.getDashboard(tenant.tenantId);
      expect(d?.advisoryStatus?.pendingDecisionsCount).toBe(1);
    });
    await eventBus.emit(tenant, { type: 'DECISION_APPROVED', subject: { tenantId: tenant.tenantId } });
    await waitFor(async () => {
      const d = await dashboardRepo.getDashboard(tenant.tenantId);
      expect(d?.advisoryStatus?.pendingDecisionsCount).toBe(0);
    });
  });

  it('does NOT increment on DECISION_PACKET_CREATED', async () => {
    const tenant = await tenantFixture.fresh();
    await eventBus.emit(tenant, {
      type: 'DECISION_PACKET_CREATED',
      subject: { tenantId: tenant.tenantId, decisionId: 'd1' },
    });
    // Wait for any side effects to settle
    await new Promise((r) => setTimeout(r, 5000));
    const d = await dashboardRepo.getDashboard(tenant.tenantId);
    expect(d?.advisoryStatus?.pendingDecisionsCount ?? 0).toBe(0);
  });
});
```

- [ ] **Step 22.2: Commit**

```bash
git add services/investor/dashboard-bff/test/integration/dashboard-bff.integration.test.ts
git commit -m "test(dashboard-bff): integration tests for trigger-driven pendingDecisionsCount"
```

---

## Phase 3 — e2e fixture rewrite + new Playwright scenario

### Task 23: Rewrite `inject-advisory-update.ts` to emit a real EventBridge trigger

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts`

- [ ] **Step 23.1: Read the current backdoor**

```bash
cat apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts
```

It currently calls a GraphQL mutation that directly mutates dashboard-bff state. Replace with a real EventBridge emission.

- [ ] **Step 23.2: Rewrite**

Replace the file content:

```ts
import type { TestContext } from '@nestfolio/test-support';
import type { FreshTenant } from '@nestfolio/e2e-feature-tests';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

/**
 * Emit a real DEPOSIT_DETECTED event on the investor + advisory buses so both
 * dashboard-bff and advisory-bff project the in-flight state. Replaces the
 * legacy backdoor that mutated dashboard-bff state directly without firing
 * any event — that backdoor caused advisory-bff to fall out of sync because
 * its projections never received a real trigger.
 *
 * After this call:
 *  - dashboard-bff.AdvisoryStatus.pendingDecisionsCount += 1
 *  - advisory-bff.AdvisoryStatus.inFlightCount += 1
 *  - decision-workflow-ctrl SF execution starts
 *
 * Use Step.waitForAdvisoryProjection or assert directly on getAdvisoryStatus
 * to gate test progression.
 */
export async function injectAdvisoryTriggerEvent(
  ctx: TestContext,
  tenant: FreshTenant,
): Promise<void> {
  const eb = new EventBridgeClient({ region: ctx.region });
  const now = new Date().toISOString();
  const eventId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await eb.send(new PutEventsCommand({
    Entries: [
      {
        EventBusName: ctx.investorBusName,
        Source: `integration-test:nestfolio-e2e`,
        DetailType: 'DEPOSIT_DETECTED',
        Detail: JSON.stringify({
          id: eventId,
          type: 'DEPOSIT_DETECTED',
          timestamp: now,
          subject: { tenantId: tenant.tenantId, amountCents: 100_000 },
          context: { tenantId: tenant.tenantId, userId: tenant.userId, region: ctx.region },
        }),
      },
    ],
  }));
}
```

(Verify via `ctx` shape — `ctx.investorBusName` may need to be added. Read `libs/test-support/src/fixtures/test-context.ts` to confirm.)

- [ ] **Step 23.3: Update callers**

```bash
grep -rn "injectAdvisoryUpdate\|inject-advisory-update" apps/nestfolio-e2e --include="*.ts" 2>/dev/null
```

For each caller, update the import and the call site to use `injectAdvisoryTriggerEvent`.

- [ ] **Step 23.4: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/inject-advisory-update.ts apps/nestfolio-e2e/src/**/*.ts
git commit -m "test(nestfolio-e2e): replace inject-advisory-update backdoor with real DEPOSIT_DETECTED emission"
```

---

### Task 24: Update `wait-for-advisory-projection.ts` with early-exit on inFlightCount

**Files:**
- Modify: `apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts`

- [ ] **Step 24.1: Add early-exit poll on getAdvisoryStatus**

Modify the existing wait function. Add an optional fast-path:

```ts
const GET_ADVISORY_STATUS = `
  query GetAdvisoryStatus {
    getAdvisoryStatus { tenantId inFlightCount lastTriggerAt updatedAt }
  }
`;

interface AdvisoryStatusResult {
  getAdvisoryStatus: { tenantId: string; inFlightCount: number; lastTriggerAt: string | null; updatedAt: string } | null;
}

/**
 * Wait until either:
 *  - advisory-bff has materialized a DecisionReadModel row (existing behavior), OR
 *  - advisory-bff's AdvisoryStatus.inFlightCount > 0 (new — banner UX is showing)
 *
 * The new fast-path lets gating tests proceed as soon as the in-flight UX is
 * observable, even before DECISION_PACKET_CREATED has fired.
 */
export async function waitForAdvisoryDecisionRow(
  ctx: TestContext,
  tenant: FreshTenant,
  opts?: { timeoutMs?: number; allowInFlightOnly?: boolean },
): Promise<void> {
  const advisory = bffClient(ctx, tenant).advisory;
  await waitForGraphQL<GetPendingDecisionsResult & Partial<AdvisoryStatusResult>>(
    advisory,
    /* gql */ `
      query Combined { 
        getPendingDecisions(limit: 5) { items { decisionId status } } 
        getAdvisoryStatus { inFlightCount } 
      }
    `,
    {},
    (result) => {
      const hasRow = (result.getPendingDecisions?.items?.length ?? 0) >= 1;
      const inFlight = (result.getAdvisoryStatus?.inFlightCount ?? 0) >= 1;
      if (opts?.allowInFlightOnly) return hasRow || inFlight;
      return hasRow;
    },
    { timeoutMs: opts?.timeoutMs ?? 90_000, intervalMs: 2_000 },
  );
}
```

- [ ] **Step 24.2: Commit**

```bash
git add apps/nestfolio-e2e/src/fixtures/wait-for-advisory-projection.ts
git commit -m "test(nestfolio-e2e): add inFlightCount early-exit to waitForAdvisoryDecisionRow"
```

---

### Task 25: Add new Playwright scenario for `/advisory` generating state

**Files:**
- Create: `apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts`

- [ ] **Step 25.1: Read an existing scenario for the test harness conventions**

```bash
ls apps/nestfolio-e2e/src/scenarios/
cat apps/nestfolio-e2e/src/scenarios/<an-existing-spec-file>.ts
```

- [ ] **Step 25.2: Write the scenario**

```ts
import { test, expect } from '@playwright/test';
import { freshTenant } from '../fixtures/fresh-tenant';
import { signIn } from '../fixtures/sign-in';
import { injectAdvisoryTriggerEvent } from '../fixtures/inject-advisory-update';

test.describe('advisory generating state', () => {
  test('shows generating empty-state when user lands on /advisory immediately after trigger', async ({ page, context }) => {
    const tenant = await freshTenant(context);
    await signIn(page, tenant);

    // Trigger a decision (real EB event)
    await injectAdvisoryTriggerEvent(context, tenant);

    // Navigate immediately — within ~2s of the trigger
    await page.goto('/advisory');

    // Expect the generating state to be visible BEFORE the row materializes
    await expect(page.locator('[data-testid=advisory-generating-state]')).toBeVisible({
      timeout: 10_000,
    });

    // Wait for the SF agent pipeline to complete (~30-75s)
    await expect(page.locator('[data-testid=advisory-decision-list]')).toBeVisible({
      timeout: 90_000,
    });

    // Generating state should be replaced (not concurrent — list is empty until PACKET fires)
    await expect(page.locator('[data-testid=advisory-generating-state]')).toBeHidden();
  });

  test('dashboard alert advances at trigger time (Phase 2)', async ({ page, context }) => {
    const tenant = await freshTenant(context);
    await signIn(page, tenant);

    await page.goto('/dashboard');

    // Trigger
    await injectAdvisoryTriggerEvent(context, tenant);

    // Alert bar should appear within a few seconds (subscription delivery)
    await expect(page.locator('[data-testid=advisory-alert-bar]')).toBeVisible({
      timeout: 10_000,
    });
  });
});
```

(`data-testid=advisory-alert-bar` may need to be added to `apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts` if not present — verify and add if missing.)

- [ ] **Step 25.3: Commit**

```bash
git add apps/nestfolio-e2e/src/scenarios/advisory-generating-state.spec.ts apps/dashboard-mfe/src/app/dashboard/advisory-alert-bar.component.ts
git commit -m "test(nestfolio-e2e): scenarios for advisory generating state + dashboard alert at trigger"
```

---

## Phase 4 — validation, docs, ship

### Task 26: Regenerate service cards

**Files:**
- Modify: `services/advisory/advisory-bff/CLAUDE.md`
- Modify: `services/investor/dashboard-bff/CLAUDE.md`
- Modify: `services/investor/investor-adpt/CLAUDE.md`

- [ ] **Step 26.1: Regenerate via audit-service skill**

For each of the 3 services, invoke the `audit-service` skill (provided in this workspace's skills list). The skill regenerates `CLAUDE.md` from the actual code state.

```bash
# Run for each service — example
# (The skill must be invoked via the Skill tool — adjust per platform)
# Skill tool call: name="audit-service", args="advisory-bff"
# Skill tool call: name="audit-service", args="dashboard-bff"
# Skill tool call: name="audit-service", args="investor-adpt"
```

- [ ] **Step 26.2: Diff and verify the regenerated cards**

```bash
git diff services/advisory/advisory-bff/CLAUDE.md
git diff services/investor/dashboard-bff/CLAUDE.md
git diff services/investor/investor-adpt/CLAUDE.md
```

Expect: ingress lists updated, transform lists updated, schema additions documented.

- [ ] **Step 26.3: Commit**

```bash
git add services/advisory/advisory-bff/CLAUDE.md services/investor/dashboard-bff/CLAUDE.md services/investor/investor-adpt/CLAUDE.md
git commit -m "docs(services): regenerate CLAUDE.md for advisory-bff, dashboard-bff, investor-adpt"
```

---

### Task 27: Update flow specs

**Files:** various under `flows/*.flow.yaml`

- [ ] **Step 27.1: Find affected flow specs**

```bash
grep -rln "advisory-bff\|dashboard-bff\|DECISION_PACKET_CREATED" flows/ 2>/dev/null
```

- [ ] **Step 27.2: For each affected spec, add the new ingress subscriptions and the new query/subscription**

Manually edit each affected `.flow.yaml`. Use `validate-flow` skill to confirm correctness.

- [ ] **Step 27.3: Run validate-flow**

```bash
# Skill tool call: name="validate-flow", args="<flow-id>"
```

- [ ] **Step 27.4: Commit**

```bash
git add flows/
git commit -m "docs(flows): update specs for advisory in-flight projection"
```

---

### Task 28: Run full validation gate

**Files:** none (executing tests + deploys)

- [ ] **Step 28.1: Unit tests**

```bash
pnpm nx test advisory-bff dashboard-bff investor-adpt advisory-mfe
```

Expected: all green.

- [ ] **Step 28.2: Deploy to dev sandbox**

```bash
bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=advisory-bff,dashboard-bff,investor-adpt 2>&1 | tee /tmp/deploy.log
```

Expected: stacks deploy successfully.

- [ ] **Step 28.3: Integration tests against deployed dev**

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run-many -t test-integration -p advisory-bff,dashboard-bff,investor-adpt
```

Expected: green.

- [ ] **Step 28.4: E2E feature tests**

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run e2e-feature-tests:test-e2e-features
```

Expected: green incl. the rewritten fixture.

- [ ] **Step 28.5: Playwright tests**

```bash
NESTFOLIO_INTEG_PREFIX=dev pnpm nx run nestfolio-e2e:e2e
```

Expected: green incl. the new generating-state scenario.

- [ ] **Step 28.6: Manual smoke test on dev**

```
1. Open the dev investor-web URL.
2. Sign in as a fresh test tenant.
3. Trigger a deposit from /onboarding or /deposit.
4. Within 2 seconds, navigate to /advisory.
5. Observe the "Agent is generating recommendations…" empty-state branch.
6. Wait 30-75s. Observe the empty-state replaced by the decision row.
7. Navigate to /dashboard (no refresh needed — subscription should keep state alive).
8. Observe the alert bar appeared at trigger time, not at PACKET_CREATED time.
```

- [ ] **Step 28.7: If all green, commit any deploy.log noise**

(no code changes — skip if nothing modified)

---

### Task 29: Mark backlog item shipped + lint + final commit

**Files:**
- Modify: `docs/backlog/advisory-empty-state-pending-decisions-count.md`
- Modify: `docs/BACKLOG.md` (auto-regenerated)

- [ ] **Step 29.1: Update backlog file frontmatter**

In `docs/backlog/advisory-empty-state-pending-decisions-count.md`, change:
- `status: active` → `status: shipped`
- Set `validation_gate:` to a short summary, e.g. `"unit + integration + e2e + playwright green on dev 2026-05-XX; manual smoke confirmed generating banner + dashboard alert advance"`

Also add a brief ship narrative paragraph to the body documenting what was actually delivered.

- [ ] **Step 29.2: Run backlog-lint --fix**

```bash
node /Users/fabiovitali/WebstormProjects/nestfolio/.claude/skills/backlog-lint/lint.mjs --fix
```

Expected: 7 rules pass; `docs/BACKLOG.md` regenerated.

- [ ] **Step 29.3: Boundary review of backlog**

```bash
cat docs/BACKLOG.md
```

Re-rank LATER, promote one item to QUEUED if appropriate (per CLAUDE.md "Backlog Discipline" → "At each workstream ship" → step 3).

- [ ] **Step 29.4: Commit**

```bash
git add docs/backlog/advisory-empty-state-pending-decisions-count.md docs/BACKLOG.md
git commit -m "docs(backlog): ship advisory-empty-state-pending-decisions-count"
```

- [ ] **Step 29.5: Push branch and open PR (deferred to user — auto mode does not push without confirmation)**

```bash
# Confirm with user before:
# git push -u origin feat/advisory-in-flight-projection
# gh pr create --title "feat: advisory in-flight state projection" --body "..."
```

---

## Self-Review Pass

Reviewing the plan against the spec section by section before handoff:

| Spec section | Plan task(s) | Coverage |
|--------------|--------------|----------|
| §3 Approach (subscribe to triggers) | Task 5 (advisory-bff ingress), Task 20 (dashboard-bff ingress) | ✓ |
| §5.1 Ingress + import TRIGGER_EVENT_TYPES | Task 5 | ✓ |
| §5.2 decision-trigger-received transform | Task 2 (TDD) | ✓ |
| §5.3 decision-packet-created decrement | Task 3 (TDD) | ✓ |
| §5.4 Egress AdvisoryStatus | Task 6 | ✓ |
| §5.5 CDC publisher AdvisoryStatus broadcast | Task 7 (TDD) | ✓ |
| §5.6 schema.graphql | Task 8 | ✓ |
| §5.7 JS resolvers | Tasks 9, 10 | ✓ |
| §6.1 5-branch component template | Task 15 | ✓ |
| §6.2 signals + computed | Task 14 | ✓ |
| §6.3 service additions | Task 13 | ✓ |
| §6.4 ngOnInit | Task 14 | ✓ |
| §6.5 i18n keys | Task 12 | ✓ |
| §7.1 investor-adpt PORTFOLIO_DRIFT_DETECTED | Tasks 16, 17, 18 | ✓ |
| §7.2 dashboard-bff ingress | Task 20 | ✓ |
| §7.3 dashboard-bff transform rewrite | Task 19 (TDD) | ✓ |
| §7.4 dashboard-mfe (no change) | acknowledged in Task 25 (test only) | ✓ |
| §9.1 Unit tests | Tasks 2, 3, 7, 19 | ✓ |
| §9.2 Integration tests | Tasks 11, 18, 22 | ✓ |
| §9.3 E2E rewrite + new scenario | Tasks 23, 24, 25 | ✓ |
| §9.4 Flow specs | Task 27 | ✓ |
| §10 Out of scope | n/a — explicitly excluded | ✓ |
| §11 Validation gate | Task 28 | ✓ |

No spec gaps. No placeholders detected on a final scan (the "TBD" string is absent). Type/method names are consistent across tasks (`AdvisoryStatusSnapshot`, `inFlightCount`, `lastTriggerAt`, `displayedInFlightCount`, `STALENESS_MS`).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-advisory-in-flight-state-projection.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints

Which approach?
