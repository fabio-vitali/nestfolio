# Deposit / Withdrawal live-push transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-establish the severed DETECTED/SETTLED→browser live-push for deposits (and add symmetric withdrawal plumbing) so the investor-mfe deposit-pending page receives funding status transitions over a subscription, fixing the two timed-out Playwright deposit specs that w5 regressed.

**Architecture:** Mirror dashboard-bff's `broadcastFromStream` pattern exactly. The Phase-4 `projectVersioned` write of the `Deposit`/`WithdrawalRequest` P1 row is **unchanged**; a new DynamoDB-stream consumer Lambda (`deposit-publisher.ts`) fires an IAM-signed `none`-datasource AppSync mutation (`publishDepositUpdate`/`publishWithdrawalUpdate`) as a post-commit side effect, which `@aws_subscribe` fans out to `onDepositUpdate(depositId)`/`onWithdrawalUpdate(withdrawalId)`. The MFE deposit service + pending page consume the deposit subscription.

**Tech Stack:** TypeScript, AWS CDK (6-construct ServiceStack), `@nestfolio/event-processor` (`broadcastFromStream`), AppSync JS resolvers (`@aws-appsync/utils`), Angular 21 + Apollo subscriptions, Jest, Playwright.

**Reference pattern (read these before starting):**
- `services/investor/dashboard-bff/src/handlers/dashboard-publisher.ts` (broadcastFromStream caller)
- `services/investor/dashboard-bff/src/graphql/js-function/publish-activity-update.fn.js` (none-datasource resolver)
- `services/investor/dashboard-bff/src/service.stack.ts:49-69` (NodejsFunction + DynamoEventSource + appsync grant)
- `services/investor/dashboard-bff/test/unit/handlers/dashboard-publisher.test.ts` (stream-handler unit test shape)
- Design: `docs/superpowers/specs/2026-06-01-deposit-withdrawal-live-push-transport-design.md`

**Key facts already verified against code:**
- `intent-executor.ts:100` stamps `__typename` on every `projectVersioned` write → the Deposit row carries `__typename: 'Deposit'`, the withdrawal row carries `__typename: 'WithdrawalRequest'` (its `sk` is `Withdrawal#<id>`, but `broadcastFromStream` keys on `__typename`). The intent-outbox rows carry `__typename: 'DepositIntent'`/`'WithdrawalIntent'` — they MUST NOT broadcast (guarded by the broadcasts map keys).
- Projected Deposit row fields (`transforms/deposit-lifecycle.ts`): `depositId, amountCents, currency, status` (UPPERCASE), `initiatedAt, detectedAt, settledAt, failedAt, reason`.
- Projected WithdrawalRequest row fields (`transforms/withdrawal-lifecycle.ts`): `withdrawalId, amountCents, currency, status` (UPPERCASE), `requestedAt, settledAt, failedAt, reason` (no `detectedAt`).
- `broadcastFromStream` (`libs/event-processor/src/pipelines/broadcast-from-stream.ts`): keys on `__typename`; `whenChanged: ['status']` ⇒ MODIFY broadcasts only on status change; `skipInsert` defaults false (INSERT broadcasts).
- investor-bff Facade already has `enableIamAuth: true`; the table stream already has ONE consumer (Egress CDC `event-publisher.ts`). The new publisher is the SECOND — DynamoDB allows up to 2 readers per shard (see Risks R-D).
- The Playwright POM (`apps/nestfolio-e2e/src/pages/investor.page.ts:30`) waits for `deposit-panel-detected`; the component renders it on `status === 'DETECTED'`. So DETECTED must keep rendering that panel, and SETTLED must also resolve to it.

**Testing scope decision (read before Task 7):** The "publisher fires the mutation" assertion lives in the Task 2 **unit** test (mirrors `dashboard-publisher.test.ts`, asserts `postAppSyncMutation` was called with the right variables incl. the `depositId`/`withdrawalId` pivot). The **integration** layer already proves Deposit P1 row materialization on `DEPOSIT_DETECTED`/`DEPOSIT_SETTLED` (existing `investor-bff.integration.test.ts:438-505, :965-1027`, 19/19 green from Phase 4) — adding another integration test would duplicate that, and asserting real WSS delivery requires a harness that the design marks **out of scope**. The real end-to-end WSS gate is the two Playwright specs in Task 7. No new integration test is written.

---

## File Structure

**investor-bff (backend):**
- Create `services/investor/investor-bff/src/graphql/js-function/publish-deposit-update.fn.js` — none-datasource resolver, echoes args (incl. `depositId` pivot).
- Create `services/investor/investor-bff/src/graphql/js-function/publish-withdrawal-update.fn.js` — same, `withdrawalId` pivot.
- Create `services/investor/investor-bff/src/handlers/deposit-publisher.ts` — `broadcastFromStream` for `Deposit` + `WithdrawalRequest`.
- Modify `services/investor/investor-bff/src/schema.graphql` — add `DepositUpdate`/`WithdrawalUpdate` types, the two `@aws_iam` publish mutations, the two `@aws_subscribe` subscriptions.
- Modify `services/investor/investor-bff/src/service.stack.ts` — register the two none-datasource resolvers + add the `DepositPublisher` NodejsFunction (DynamoEventSource + appsync grant).
- Create `services/investor/investor-bff/test/unit/graphql/publish-deposit-update.test.ts` + `publish-withdrawal-update.test.ts`.
- Create `services/investor/investor-bff/test/unit/handlers/deposit-publisher.test.ts`.

**investor-mfe (frontend):**
- Modify `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts` — replace `ON_DEPOSIT_EVENT` with `ON_DEPOSIT_UPDATE`; add `ON_WITHDRAWAL_UPDATE`.
- Modify `apps/investor-mfe/src/app/services/deposit.service.ts` — point subscription at `onDepositUpdate`, map payload → `DepositEvent`, widen status union.
- Modify `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts` — `onEvent` resolves `SETTLED` to the detected panel.
- Modify `apps/investor-mfe/test/app/services/deposit.service.spec.ts` + `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts`.

**Docs (Task 7):** `services/investor/investor-bff/CLAUDE.md` (Handlers + Facade subscriptions + Tests), the backlog file, MEMORY/BACKLOG regen.

---

## Task 1: BFF publish resolvers + unit tests

**Files:**
- Create: `services/investor/investor-bff/src/graphql/js-function/publish-deposit-update.fn.js`
- Create: `services/investor/investor-bff/src/graphql/js-function/publish-withdrawal-update.fn.js`
- Test: `services/investor/investor-bff/test/unit/graphql/publish-deposit-update.test.ts`
- Test: `services/investor/investor-bff/test/unit/graphql/publish-withdrawal-update.test.ts`

- [ ] **Step 1: Write the failing deposit-resolver test**

Create `services/investor/investor-bff/test/unit/graphql/publish-deposit-update.test.ts`:

```ts
import { request, response } from '../../../src/graphql/js-function/publish-deposit-update.fn.js';

describe('publish-deposit-update resolver', () => {
  it('request returns an empty NONE-datasource payload', () => {
    expect(request({})).toEqual({ payload: {} });
  });

  it('response echoes arguments INCLUDING depositId (the @aws_subscribe filter pivot)', () => {
    const args = {
      depositId: 'dep-1',
      status: 'DETECTED',
      amountCents: 500000,
      currency: 'USD',
      detectedAt: '2026-06-01T12:00:00Z',
      settledAt: null,
      failedAt: null,
      reason: null,
    };
    const out = response({ arguments: args });
    // The pivot MUST be present in the response or every broadcast drops silently
    // (feedback_appsync_subscribe_filter_args).
    expect(out.depositId).toBe('dep-1');
    expect(out).toMatchObject(args);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns=publish-deposit-update`
Expected: FAIL — cannot find module `publish-deposit-update.fn.js`.

- [ ] **Step 3: Create the deposit resolver (minimal)**

Create `services/investor/investor-bff/src/graphql/js-function/publish-deposit-update.fn.js` (mirror `dashboard-bff/.../publish-activity-update.fn.js`):

```js
import { util } from '@aws-appsync/utils';

// NONE data source: this mutation is fired IAM-signed from the investor-bff
// deposit-publisher stream Lambda after a Deposit P1 row write. Its sole purpose
// is to drive the @aws_subscribe(mutations: ["publishDepositUpdate"]) fan-out to
// clients subscribed via onDepositUpdate(depositId).
//
// depositId MUST be returned in the response — AppSync's @aws_subscribe filter
// matches the subscription's depositId arg against fields in the RESPONSE, not
// the input args. Forgetting this drops every broadcast silently.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { depositId, status, amountCents, currency, detectedAt, settledAt, failedAt, reason } =
    ctx.arguments;
  return { depositId, status, amountCents, currency, detectedAt, settledAt, failedAt, reason };
}
```

(`util` is imported to mirror the reference resolver byte-for-byte; the linter accepts the unused import there, so it accepts it here.)

- [ ] **Step 4: Write the failing withdrawal-resolver test**

Create `services/investor/investor-bff/test/unit/graphql/publish-withdrawal-update.test.ts`:

```ts
import { request, response } from '../../../src/graphql/js-function/publish-withdrawal-update.fn.js';

describe('publish-withdrawal-update resolver', () => {
  it('request returns an empty NONE-datasource payload', () => {
    expect(request({})).toEqual({ payload: {} });
  });

  it('response echoes arguments INCLUDING withdrawalId (the @aws_subscribe filter pivot)', () => {
    const args = {
      withdrawalId: 'wd-1',
      status: 'SETTLED',
      amountCents: 200000,
      currency: 'USD',
      settledAt: '2026-06-01T13:00:00Z',
      failedAt: null,
      reason: null,
    };
    const out = response({ arguments: args });
    expect(out.withdrawalId).toBe('wd-1');
    expect(out).toMatchObject(args);
  });
});
```

- [ ] **Step 5: Create the withdrawal resolver**

Create `services/investor/investor-bff/src/graphql/js-function/publish-withdrawal-update.fn.js`:

```js
import { util } from '@aws-appsync/utils';

// NONE data source: fired IAM-signed from the investor-bff deposit-publisher
// stream Lambda after a WithdrawalRequest P1 row write. Drives the
// @aws_subscribe(mutations: ["publishWithdrawalUpdate"]) fan-out to clients on
// onWithdrawalUpdate(withdrawalId).
//
// withdrawalId MUST be returned in the response — see publish-deposit-update.fn.js.
export function request(ctx) {
  return { payload: {} };
}

export function response(ctx) {
  const { withdrawalId, status, amountCents, currency, settledAt, failedAt, reason } =
    ctx.arguments;
  return { withdrawalId, status, amountCents, currency, settledAt, failedAt, reason };
}
```

- [ ] **Step 6: Run both resolver tests to verify they pass**

Run: `pnpm nx run investor-bff:test --testPathPatterns="publish-deposit-update|publish-withdrawal-update"`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add services/investor/investor-bff/src/graphql/js-function/publish-deposit-update.fn.js \
  services/investor/investor-bff/src/graphql/js-function/publish-withdrawal-update.fn.js \
  services/investor/investor-bff/test/unit/graphql/publish-deposit-update.test.ts \
  services/investor/investor-bff/test/unit/graphql/publish-withdrawal-update.test.ts
git commit -m "feat(investor-bff): none-datasource publish resolvers for funding live-push"
```

---

## Task 2: deposit-publisher stream handler + unit tests

**Files:**
- Create: `services/investor/investor-bff/src/handlers/deposit-publisher.ts`
- Test: `services/investor/investor-bff/test/unit/handlers/deposit-publisher.test.ts`

- [ ] **Step 1: Write the failing handler test**

Create `services/investor/investor-bff/test/unit/handlers/deposit-publisher.test.ts` (mirror `dashboard-bff/.../dashboard-publisher.test.ts`):

```ts
import type { DynamoDBStreamEvent } from 'aws-lambda';

const postAppSyncMutation = jest.fn().mockResolvedValue(undefined);
// broadcastFromStream imports postAppSyncMutation via a relative path inside the
// lib. The moduleNameMapper resolves @nestfolio/event-processor/(.*) → lib src,
// so Jest treats both the relative and the alias as the same module.
jest.mock('@nestfolio/event-processor/shared/post-appsync-mutation', () => ({ postAppSyncMutation }));

process.env.APPSYNC_URL = 'https://x.example/graphql';
process.env.AWS_REGION = 'us-east-1';

import { handler } from '../../../src/handlers/deposit-publisher';

function streamEvent(record: {
  eventName: 'INSERT' | 'MODIFY';
  newImage: Record<string, unknown>;
  oldImage?: Record<string, unknown>;
}): DynamoDBStreamEvent {
  const m = (item: Record<string, unknown>): Record<string, { S?: string; N?: string }> => {
    const out: Record<string, { S?: string; N?: string }> = {};
    for (const [k, v] of Object.entries(item)) {
      if (typeof v === 'string') out[k] = { S: v };
      else if (typeof v === 'number') out[k] = { N: String(v) };
    }
    return out;
  };
  return {
    Records: [{
      eventID: 'evt-1',
      eventName: record.eventName,
      eventSource: 'aws:dynamodb',
      dynamodb: {
        NewImage: m(record.newImage),
        ...(record.oldImage ? { OldImage: m(record.oldImage) } : {}),
      },
    }],
  } as unknown as DynamoDBStreamEvent;
}

describe('deposit-publisher', () => {
  beforeEach(() => (postAppSyncMutation as jest.Mock).mockReset().mockResolvedValue(undefined));

  it('broadcasts publishDepositUpdate when Deposit row status REQUESTED→DETECTED (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'REQUESTED', amountCents: 500000, currency: 'USD' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishDepositUpdate');
    expect(call.variables).toMatchObject({
      depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z',
    });
  });

  it('skips Deposit MODIFY when status is unchanged', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-1', __typename: 'Deposit', depositId: 'dep-1', status: 'DETECTED', amountCents: 500000, currency: 'USD', detectedAt: '2026-06-01T12:00:00Z', updatedAt: '2026-06-01T12:00:05Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });

  it('broadcasts on Deposit INSERT (first projected REQUESTED row)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Deposit#dep-2', __typename: 'Deposit', depositId: 'dep-2', status: 'REQUESTED', amountCents: 100000, currency: 'USD' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.variables).toMatchObject({ depositId: 'dep-2', status: 'REQUESTED' });
  });

  it('broadcasts publishWithdrawalUpdate when WithdrawalRequest status REQUESTED→SETTLED (MODIFY)', async () => {
    await handler(streamEvent({
      eventName: 'MODIFY',
      oldImage: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-1', __typename: 'WithdrawalRequest', withdrawalId: 'wd-1', status: 'REQUESTED', amountCents: 200000, currency: 'USD' },
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'Withdrawal#wd-1', __typename: 'WithdrawalRequest', withdrawalId: 'wd-1', status: 'SETTLED', amountCents: 200000, currency: 'USD', settledAt: '2026-06-01T13:00:00Z' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).toHaveBeenCalledTimes(1);
    const call = (postAppSyncMutation as jest.Mock).mock.calls[0][0];
    expect(call.mutation).toContain('publishWithdrawalUpdate');
    expect(call.variables).toMatchObject({
      withdrawalId: 'wd-1', status: 'SETTLED', amountCents: 200000, currency: 'USD', settledAt: '2026-06-01T13:00:00Z',
    });
  });

  it('does NOT broadcast on the DepositIntent outbox row (only the projected Deposit row)', async () => {
    await handler(streamEvent({
      eventName: 'INSERT',
      newImage: { pk: 'InvestorProfile#t1#u1', sk: 'DepositIntent#dep-3', __typename: 'DepositIntent', depositId: 'dep-3', status: 'INITIATED', amountCents: 100000, currency: 'USD' },
    }), {} as never, () => {});
    expect(postAppSyncMutation).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm nx run investor-bff:test --testPathPatterns=deposit-publisher`
Expected: FAIL — cannot find module `../../../src/handlers/deposit-publisher`.

- [ ] **Step 3: Create the handler**

Create `services/investor/investor-bff/src/handlers/deposit-publisher.ts`:

```ts
import { broadcastFromStream } from '@nestfolio/event-processor';

// depositId / withdrawalId MUST be in the mutation selection set: AppSync's
// @aws_subscribe filter matches the subscription's id argument against fields in
// the mutation RESPONSE (not the input args). Without selecting the pivot id, the
// filter never matches and the broadcast silently drops (feedback_appsync_subscribe_filter_args).
const PUBLISH_DEPOSIT_UPDATE = `
  mutation PublishDepositUpdate(
    $depositId: ID!, $status: String!, $amountCents: Int!, $currency: String!,
    $detectedAt: String, $settledAt: String, $failedAt: String, $reason: String
  ) {
    publishDepositUpdate(
      depositId: $depositId, status: $status, amountCents: $amountCents, currency: $currency,
      detectedAt: $detectedAt, settledAt: $settledAt, failedAt: $failedAt, reason: $reason
    ) {
      depositId
      status
      amountCents
      currency
      detectedAt
      settledAt
      failedAt
      reason
    }
  }
`;

const PUBLISH_WITHDRAWAL_UPDATE = `
  mutation PublishWithdrawalUpdate(
    $withdrawalId: ID!, $status: String!, $amountCents: Int!, $currency: String!,
    $settledAt: String, $failedAt: String, $reason: String
  ) {
    publishWithdrawalUpdate(
      withdrawalId: $withdrawalId, status: $status, amountCents: $amountCents, currency: $currency,
      settledAt: $settledAt, failedAt: $failedAt, reason: $reason
    ) {
      withdrawalId
      status
      amountCents
      currency
      settledAt
      failedAt
      reason
    }
  }
`;

const APPSYNC_URL = process.env['APPSYNC_URL'];
if (!APPSYNC_URL) {
  throw new Error('deposit-publisher: APPSYNC_URL is required');
}

export const handler = broadcastFromStream({
  serviceName: 'investor-bff',
  appsyncUrl: APPSYNC_URL,
  region: process.env['AWS_REGION'],
  broadcasts: {
    // Keyed by __typename: the projected P1 rows ('Deposit'/'WithdrawalRequest'),
    // NOT the intent-outbox rows ('DepositIntent'/'WithdrawalIntent') that live in
    // the same table and also stream — those have no entry, so they never fire.
    Deposit: {
      mutation: PUBLISH_DEPOSIT_UPDATE,
      // Only status transitions matter to the pending UI; an idempotent same-status
      // re-projection must not re-broadcast.
      whenChanged: ['status'],
      mapImage: (item) => ({
        depositId: String(item['depositId']),
        status: String(item['status']),
        amountCents: Number(item['amountCents'] ?? 0),
        currency: String(item['currency'] ?? 'USD'),
        detectedAt: item['detectedAt'] != null ? String(item['detectedAt']) : null,
        settledAt: item['settledAt'] != null ? String(item['settledAt']) : null,
        failedAt: item['failedAt'] != null ? String(item['failedAt']) : null,
        reason: item['reason'] != null ? String(item['reason']) : null,
      }),
    },
    WithdrawalRequest: {
      mutation: PUBLISH_WITHDRAWAL_UPDATE,
      whenChanged: ['status'],
      mapImage: (item) => ({
        withdrawalId: String(item['withdrawalId']),
        status: String(item['status']),
        amountCents: Number(item['amountCents'] ?? 0),
        currency: String(item['currency'] ?? 'USD'),
        settledAt: item['settledAt'] != null ? String(item['settledAt']) : null,
        failedAt: item['failedAt'] != null ? String(item['failedAt']) : null,
        reason: item['reason'] != null ? String(item['reason']) : null,
      }),
    },
  },
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm nx run investor-bff:test --testPathPatterns=deposit-publisher`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/investor/investor-bff/src/handlers/deposit-publisher.ts \
  services/investor/investor-bff/test/unit/handlers/deposit-publisher.test.ts
git commit -m "feat(investor-bff): deposit-publisher broadcasts Deposit/WithdrawalRequest status transitions"
```

---

## Task 3: BFF schema + CDK wiring

**Files:**
- Modify: `services/investor/investor-bff/src/schema.graphql`
- Modify: `services/investor/investor-bff/src/service.stack.ts`

- [ ] **Step 1: Add the two publish mutations to the schema**

In `services/investor/investor-bff/src/schema.graphql`, inside `type Mutation { ... }`, after the `updateFeatureFlag(...)` line (before the closing `}`), add:

```graphql
  publishDepositUpdate(
    depositId: ID!
    status: String!
    amountCents: Int!
    currency: String!
    detectedAt: String
    settledAt: String
    failedAt: String
    reason: String
  ): DepositUpdate @aws_iam
  publishWithdrawalUpdate(
    withdrawalId: ID!
    status: String!
    amountCents: Int!
    currency: String!
    settledAt: String
    failedAt: String
    reason: String
  ): WithdrawalUpdate @aws_iam
```

- [ ] **Step 2: Add the two subscriptions to the schema**

In the same file, inside `type Subscription { ... }`, after the `onFeatureFlagUpdate` block (before the closing `}`), add:

```graphql
  onDepositUpdate(depositId: ID!): DepositUpdate
    @aws_subscribe(mutations: ["publishDepositUpdate"])
  onWithdrawalUpdate(withdrawalId: ID!): WithdrawalUpdate
    @aws_subscribe(mutations: ["publishWithdrawalUpdate"])
```

- [ ] **Step 3: Add the two live-push types to the schema**

In the same file, immediately after the existing `type WithdrawalRequest { ... }` block (ends at the line `}` before `type ClosureRequest`), add:

```graphql
type DepositUpdate @aws_cognito_user_pools @aws_iam {
  depositId: ID!
  status: String!
  amountCents: Int!
  currency: String!
  detectedAt: String
  settledAt: String
  failedAt: String
  reason: String
}

type WithdrawalUpdate @aws_cognito_user_pools @aws_iam {
  withdrawalId: ID!
  status: String!
  amountCents: Int!
  currency: String!
  settledAt: String
  failedAt: String
  reason: String
}
```

- [ ] **Step 4: Add CDK imports to the stack**

In `services/investor/investor-bff/src/service.stack.ts`, after the existing `import { PolicyStatement } from 'aws-cdk-lib/aws-iam';` line, add:

```ts
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { defaultLambdaProps } from '@nestfolio/cdk-constructs/utils';
```

- [ ] **Step 5: Register the two none-datasource resolvers**

In the same file, change the `discoverJsResolvers` `noneDataSource` array from:

```ts
        noneDataSource: ['requestAccountClosure'],
```

to:

```ts
        noneDataSource: ['requestAccountClosure', 'publishDepositUpdate', 'publishWithdrawalUpdate'],
```

- [ ] **Step 6: Add the DepositPublisher stream consumer**

In the same file, immediately before `new MfeBucket(this, 'MfeBucket', { mfeKey: 'investor' });`, add (mirror `dashboard-bff/service.stack.ts:49-69`):

```ts
    // DDB-stream-driven funding publisher: fans Deposit / WithdrawalRequest P1 row
    // status transitions out to clients via @aws_subscribe (onDepositUpdate /
    // onWithdrawalUpdate). The projectVersioned write (deposit/withdrawal-lifecycle
    // transforms) is unchanged; this is a post-commit side effect off the stream —
    // no race with the engine's write. SECOND stream consumer on this table (Egress
    // CDC is the first); DynamoDB allows up to 2 readers per shard.
    const depositPublisher = new NodejsFunction(this, 'DepositPublisher', {
      ...defaultLambdaProps(this),
      entry: join(__dirname, 'handlers', 'deposit-publisher.ts'),
      environment: facade.graphqlUrl ? { APPSYNC_URL: facade.graphqlUrl } : {},
    });
    depositPublisher.addEventSource(
      new DynamoEventSource(state.getTable(), {
        startingPosition: StartingPosition.LATEST,
        retryAttempts: 3,
      }),
    );
    if (facade.api) {
      depositPublisher.addToRolePolicy(new PolicyStatement({
        actions: ['appsync:GraphQL'],
        resources: [`${facade.api.arn}/*`],
      }));
    }
```

- [ ] **Step 7: Verify synth, typecheck, lint, and the full BFF unit suite are green**

Run: `pnpm nx run investor-bff:test && pnpm nx run investor-bff:lint && pnpm nx run investor-bff:typecheck`
Expected: PASS. The `discoverJsResolvers` pass at synth time must find `publish-deposit-update.fn.js` + `publish-withdrawal-update.fn.js` for the two registered mutation names (filename-derived). If a stack/synth test exists it must still pass.

Run (synth sanity — confirms the new NodejsFunction + DynamoEventSource resolve and the schema parses): `pnpm nx run investor-bff:build`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-bff/src/schema.graphql services/investor/investor-bff/src/service.stack.ts
git commit -m "feat(investor-bff): wire funding live-push schema + DepositPublisher stream consumer"
```

---

## Task 4: MFE subscription documents

**Files:**
- Modify: `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts`

- [ ] **Step 1: Replace the deposit subscription document; add the withdrawal one**

Replace the ENTIRE contents of `apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts` with:

```ts
export const ON_DEPOSIT_UPDATE = `
  subscription OnDepositUpdate($depositId: ID!) {
    onDepositUpdate(depositId: $depositId) {
      depositId
      status
      amountCents
      currency
      detectedAt
      settledAt
      failedAt
      reason
    }
  }
`;

// Symmetric withdrawal live-push (design D3). No MFE page consumes it yet — the
// document exists so the funding read-model is symmetric and a future withdrawal
// pending-page can wire it without a BFF round-trip.
export const ON_WITHDRAWAL_UPDATE = `
  subscription OnWithdrawalUpdate($withdrawalId: ID!) {
    onWithdrawalUpdate(withdrawalId: $withdrawalId) {
      withdrawalId
      status
      amountCents
      currency
      settledAt
      failedAt
      reason
    }
  }
`;
```

- [ ] **Step 2: Commit (compilation verified by Task 5's build/test)**

```bash
git add apps/investor-mfe/src/app/graphql/investor-bff.subscriptions.ts
git commit -m "feat(investor-mfe): onDepositUpdate/onWithdrawalUpdate subscription documents"
```

---

## Task 5: MFE deposit.service — point at onDepositUpdate + map payload

**Files:**
- Modify: `apps/investor-mfe/src/app/services/deposit.service.ts`
- Test: `apps/investor-mfe/test/app/services/deposit.service.spec.ts`

- [ ] **Step 1: Update the failing service spec**

In `apps/investor-mfe/test/app/services/deposit.service.spec.ts`, replace the two subscription test blocks (`'subscribeToDepositEvent: forwards subscription payloads to the callback'` and `'unsubscribeFromDepositEvent: ignores further payloads'`) with versions that exercise the new `onDepositUpdate` shape + mapping. Replace from the start of the first to the end of the second:

```ts
  it('subscribeToDepositEvent: subscribes to onDepositUpdate and maps payload → DepositEvent', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    expect(graphql.subscribe).toHaveBeenCalledWith(
      expect.stringContaining('onDepositUpdate'),
      { depositId },
    );
    subject.next({
      onDepositUpdate: {
        depositId, status: 'DETECTED', amountCents: 10_000, currency: 'USD',
        detectedAt: '2026-04-22T00:01:00.000Z', settledAt: null, failedAt: null, reason: null,
      },
    });
    expect(received).toEqual([{
      depositId, status: 'DETECTED', amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    }]);
  });

  it('subscribeToDepositEvent: maps SETTLED (settledAt) → occurredAt when detectedAt is absent', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    subject.next({
      onDepositUpdate: {
        depositId, status: 'SETTLED', amountCents: 10_000, currency: 'USD',
        detectedAt: null, settledAt: '2026-04-22T00:02:00.000Z', failedAt: null, reason: null,
      },
    });
    expect(received[0]).toMatchObject({ status: 'SETTLED', occurredAt: '2026-04-22T00:02:00.000Z' });
  });

  it('unsubscribeFromDepositEvent: ignores further payloads', () => {
    const subject = new Subject<{ onDepositUpdate: Record<string, unknown> }>();
    graphql.subscribe.mockReturnValue(subject.asObservable());
    const received: DepositEvent[] = [];
    service.subscribeToDepositEvent(depositId, (e) => received.push(e));
    service.unsubscribeFromDepositEvent();
    subject.next({
      onDepositUpdate: {
        depositId, status: 'DETECTED', amountCents: 1, currency: 'USD',
        detectedAt: '2026-04-22T00:01:00.000Z', settledAt: null, failedAt: null, reason: null,
      },
    });
    expect(received).toEqual([]);
  });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm nx run investor-mfe:test --testPathPatterns=deposit.service`
Expected: FAIL — `graphql.subscribe` was called with `onDepositEvent`, not `onDepositUpdate`; mapping shape differs.

- [ ] **Step 3: Update the service implementation**

In `apps/investor-mfe/src/app/services/deposit.service.ts`:

(a) Change the subscriptions import (line 6) from:

```ts
import { ON_DEPOSIT_EVENT } from '../graphql/investor-bff.subscriptions';
```

to:

```ts
import { ON_DEPOSIT_UPDATE } from '../graphql/investor-bff.subscriptions';
```

(b) Replace the `DepositEvent` interface (lines 19-27) with the page-facing shape (drop `tenantId`, widen `status`) plus the raw payload type:

```ts
export interface DepositEvent {
  depositId: string;
  status: 'INITIATED' | 'REQUESTED' | 'DETECTED' | 'SETTLED' | 'FAILED';
  amountCents: number;
  currency: string;
  occurredAt: string;
  reason: string | null;
}

// Raw onDepositUpdate subscription payload (BFF DepositUpdate type).
interface DepositUpdatePayload {
  depositId: string;
  status: string;
  amountCents: number;
  currency: string;
  detectedAt: string | null;
  settledAt: string | null;
  failedAt: string | null;
  reason: string | null;
}
```

(c) Replace the `subscribeToDepositEvent` method body (lines 61-71) with:

```ts
  subscribeToDepositEvent(depositId: string, onEvent: (e: DepositEvent) => void): void {
    this.unsubscribeFromDepositEvent();
    const obs = this.graphql.subscribe<{ onDepositUpdate: DepositUpdatePayload }>(
      ON_DEPOSIT_UPDATE,
      { depositId },
    );
    this.subscription = obs.subscribe({
      next: (data) => {
        const u = data.onDepositUpdate;
        if (!u) return;
        onEvent({
          depositId: u.depositId,
          status: u.status as DepositEvent['status'],
          amountCents: u.amountCents,
          currency: u.currency,
          occurredAt: u.detectedAt ?? u.settledAt ?? u.failedAt ?? '',
          reason: u.reason ?? null,
        });
      },
      error: (err) => {
        // eslint-disable-next-line no-console
        console.error('Deposit subscription error', err);
      },
    });
  }
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm nx run investor-mfe:test --testPathPatterns=deposit.service`
Expected: PASS (all DepositService tests, including the two new mapping tests).

- [ ] **Step 5: Commit**

```bash
git add apps/investor-mfe/src/app/services/deposit.service.ts \
  apps/investor-mfe/test/app/services/deposit.service.spec.ts
git commit -m "feat(investor-mfe): deposit.service consumes onDepositUpdate, maps to DepositEvent"
```

---

## Task 6: MFE deposit-pending-page — resolve SETTLED to the detected panel

**Files:**
- Modify: `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts`
- Test: `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts`

- [ ] **Step 1: Update the failing component spec**

In `apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts`:

(a) The existing DETECTED-frame test (`'subscription DETECTED frame after INITIATED hydration → state=detected, timeout cleared'`) builds a `DepositEvent` literal with a `tenantId` field that no longer exists on the type. Replace its `evt` literal (the `const evt: DepositEvent = { ... };` block) with:

```ts
    const evt: DepositEvent = {
      depositId, status: 'DETECTED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:01:00.000Z', reason: null,
    };
```

(b) Immediately after that test's closing `});`, add a new SETTLED test:

```ts
  it('subscription SETTLED frame after INITIATED hydration → detected panel (DETECTED and SETTLED both mean funds arrived)', async () => {
    deposit.getDeposit.mockResolvedValue(initiated);
    const { component } = await mountWith({ deposit });
    await component.ngOnInit();
    const onEvent = deposit.subscribeToDepositEvent.mock.calls[0][1];

    const evt: DepositEvent = {
      depositId, status: 'SETTLED',
      amountCents: 10_000, currency: 'USD',
      occurredAt: '2026-04-22T00:02:00.000Z', reason: null,
    };
    onEvent(evt);
    // Renders the same deposit-panel-detected the Playwright POM waits for.
    expect(component.state()).toBe('detected');
  });
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `pnpm nx run investor-mfe:test --testPathPatterns=deposit-pending-page`
Expected: FAIL — the new SETTLED test leaves `state()` at `'initiated'` (current `onEvent` ignores SETTLED).
(The DETECTED test edit alone would still pass; the SETTLED test is the red bar.)

- [ ] **Step 3: Update the component's onEvent**

In `apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts`, replace the `onEvent` method (lines 170-180) with:

```ts
  private onEvent(event: DepositEvent): void {
    // DETECTED and SETTLED both mean "funds arrived" for the pending UX — render
    // the same terminal panel (deposit-panel-detected). A late REQUESTED frame is
    // ignored so the page never regresses out of detected/failed (monotonic).
    if (event.status === 'DETECTED' || event.status === 'SETTLED') {
      this.deposit.update((d) => (d ? { ...d, status: 'DETECTED', detectedAt: event.occurredAt } : d));
      this.clearTimeout();
      this.state.set('detected');
    } else if (event.status === 'FAILED') {
      this.failureReason.set(event.reason ?? 'Deposit failed');
      this.clearTimeout();
      this.state.set('failed');
    }
  }
```

- [ ] **Step 4: Run the spec to verify it passes**

Run: `pnpm nx run investor-mfe:test --testPathPatterns=deposit-pending-page`
Expected: PASS (all DepositPendingPageComponent tests).

- [ ] **Step 5: Run the full investor-mfe unit suite + lint**

Run: `pnpm nx run investor-mfe:test && pnpm nx run investor-mfe:lint`
Expected: PASS. (Confirms no other reference to the removed `ON_DEPOSIT_EVENT`/`tenantId` lingers.)

- [ ] **Step 6: Commit**

```bash
git add apps/investor-mfe/src/app/deposit/deposit-pending-page.component.ts \
  apps/investor-mfe/test/app/deposit/deposit-pending-page.component.spec.ts
git commit -m "feat(investor-mfe): deposit pending page resolves SETTLED to the detected panel"
```

---

## Task 7: Pre-deploy gate → deploy → Playwright gate (×2) → docs

**Files:**
- Modify: `services/investor/investor-bff/CLAUDE.md`
- Modify: `docs/backlog/bff-readmodel-w5-externally-settled-entities.md` (closing phase happens after this task, in the conversation's closing phase; this task only updates the service card)

- [ ] **Step 1: Pre-deploy affected gate**

Run: `pnpm nx affected -t test,lint --base=main`
Expected: PASS, 0 errors across affected projects (investor-bff, investor-mfe, plus any dependents).

- [ ] **Step 2: Deploy investor-bff + investor-mfe (+ investor-web host) to dev**

Run: `bash infrastructure/scripts/deploy.sh sandbox --prefix=dev --services=investor-bff,investor-web,investor-mfe 2>&1 | tee /tmp/w5-transport-deploy.log`
Expected: investor-bff stack deploys (new schema, 2 new resolvers, DepositPublisher Lambda + event source mapping); the investor MFE remote rebuilds and uploads to S3 (R-B — `investor-mfe` MUST be in the filter or `deploy-mfes.sh` skips the batch); investor-web host re-syncs. Watch for: (a) the DepositPublisher event-source-mapping creating cleanly alongside the existing Egress CDC mapping (R-D, 2 consumers); (b) no AppSync schema validation error on the new `@aws_subscribe`/`@aws_iam` directives.

- [ ] **Step 3: First Playwright deposit run**

Run: `pnpm nx run nestfolio-e2e:e2e` scoped to the two deposit specs via the env-var launcher (per `feedback_e2e_nx_wrapper_strips_quotes` — never pass a pipe pattern as a CLI arg):

```bash
PLAYWRIGHT_GREP='deposit reload mid-flight|new-investor-happy-path' pnpm nx run nestfolio-e2e:e2e
```

Expected: PASS — `deposit-reload-mid-flight` reaches `deposit-panel-detected` after F5; `new-investor-happy-path` reaches `deposit-panel-detected` at step 7. If either still times out at `waitForDetected` (120s), pull CloudWatch logs from `/aws/lambda/dev-investor-bff-DepositPublisher*` for the failing window BEFORE forming hypotheses (`feedback_check_screenshot_first` + read `test-results/.../error-context.md`).

- [ ] **Step 4: Second Playwright deposit run (anti-flake)**

Run the SAME command again:

```bash
PLAYWRIGHT_GREP='deposit reload mid-flight|new-investor-happy-path' pnpm nx run nestfolio-e2e:e2e
```

Expected: PASS again. Two consecutive green runs are required before declaring the gate met (`apps/nestfolio-e2e/CLAUDE.md` anti-flake discipline + `feedback_flake_means_broken`). A rerun-pass after a fail is NOT evidence — if run 1 failed and run 2 passed, treat it as broken and investigate the run-1 window.

- [ ] **Step 5: Update the investor-bff service card**

In `services/investor/investor-bff/CLAUDE.md`:
- Under `## Facade` → Subscription line, append: `onDepositUpdate (@aws_subscribe on publishDepositUpdate), onWithdrawalUpdate (@aws_subscribe on publishWithdrawalUpdate)`; and add `publishDepositUpdate (@aws_iam, noneDataSource), publishWithdrawalUpdate (@aws_iam, noneDataSource)` to the Mutation line.
- Under `## Handlers`, add: `deposit-publisher.ts — DDB-stream-driven broadcaster (broadcastFromStream): fires publishDepositUpdate on Deposit P1 row status transitions + publishWithdrawalUpdate on WithdrawalRequest, keyed by __typename. SECOND table-stream consumer (Egress CDC is the first).`
- Under `## Tests` → Unit, add: `handlers/deposit-publisher.test.ts, graphql/publish-deposit-update.test.ts, graphql/publish-withdrawal-update.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-bff/CLAUDE.md
git commit -m "docs(investor-bff): card reflects funding live-push transport (deposit-publisher + publish resolvers)"
```

---

## Closing phase (handled in the conversation after Task 7, not a TDD task)

Per the backlog Resume state: set `docs/backlog/bff-readmodel-w5-externally-settled-entities.md` `status: shipped` + fill `validation_gate` (integration 5/5 + scoped Jest e2e 2/2 + Playwright 2/2 ×2 deposit specs), run `node .claude/skills/backlog-lint/lint.mjs --fix`, then `superpowers:finishing-a-development-branch` (PR flow — this is complex-lane work), then `ExitWorktree`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Design §Components/1 (BFF schema + resolvers) → Task 1 (resolvers) + Task 3 (schema). ✅
- Design §Components/2 (publisher Lambda + CDK) → Task 2 (handler) + Task 3 (CDK). ✅
- Design §Components/3 (investor-mfe subscriptions/service/page) → Tasks 4, 5, 6. ✅
- Design D2 (filter key = depositId/withdrawalId) → enforced in resolver response (Task 1), mutation selection (Task 2), subscription doc (Task 4). ✅
- Design D3 (symmetric withdrawal) → WithdrawalUpdate type/mutation/subscription/broadcast all present (Tasks 1-4); no withdrawal page (out of scope). ✅
- Design §Testing → unit (Tasks 1, 2, 5, 6), Playwright ×2 (Task 7); integration intentionally reuses existing Phase-4 coverage (documented in "Testing scope decision"). ✅
- Risk R-A (pivot omission) → publish-resolver pivot unit test (Task 1) + Playwright gate (Task 7). ✅
- Risk R-B (MFE federation rebuild) → `investor-mfe` in deploy filter + watch note (Task 7 Step 2). ✅
- Risk R-C (INITIATED vs first projected status / monotonicity) → `onEvent` ignores REQUESTED and only moves forward to detected/failed; comment added (Task 6 Step 3). ✅
- Risk R-D (2 stream consumers) → documented in Task 3 Step 6 + Task 7 Step 2 deploy-watch. ✅

**Placeholder scan:** No TBD/TODO/"add error handling"/"similar to" — every code step shows complete code. ✅

**Type consistency:** `DepositEvent` (status union `INITIATED|REQUESTED|DETECTED|SETTLED|FAILED`, fields `depositId/status/amountCents/currency/occurredAt/reason`) is used identically in Task 5 (impl + spec) and Task 6 (component + spec). `DepositUpdatePayload` matches the `DepositUpdate` GraphQL type (Task 3) and the `mapImage` output (Task 2). Mutation names `publishDepositUpdate`/`publishWithdrawalUpdate` match across schema (Task 3), resolvers (Task 1), handler mutation strings (Task 2), and `noneDataSource` registration (Task 3). ✅

## Risks (carried from design + discovered during planning)
- **R-A — @aws_subscribe filter pivot omission** (design #1). The `depositId`/`withdrawalId` must be in the response type, the resolver return, AND the publisher's mutation selection. All three covered.
- **R-B — MFE federation rebuild.** `investor-mfe` must be in the `--services` filter or `deploy-mfes.sh` skips the remote rebuild → Playwright runs against stale JS.
- **R-C — status monotonicity.** Optimistic INITIATED is client-only; first projected status is REQUESTED (ignored by the page) → DETECTED → SETTLED. `projectVersioned`'s version guard means stale lower-version events produce no write → no stream record → no out-of-order broadcast.
- **R-D — two DynamoDB stream consumers** (discovered in planning). investor-bff's table now has Egress CDC + DepositPublisher = 2 ESMs. AWS documents 2 readers/shard as the supported max. Watch `IteratorAge`/throttling on the new mapping after deploy; if it bites, the fallback is a Kinesis fan-out (out of scope here — file-and-continue).
