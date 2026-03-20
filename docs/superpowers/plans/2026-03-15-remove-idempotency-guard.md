# Remove IdempotencyGuard — Event-Keyed Conditional Writes

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `IdempotencyGuard` class with event-keyed conditional writes (`putIfNotExists`, `guardedWrite`) so deduplication is performed by the business write itself, eliminating the separate guard round-trip.

**Architecture:** Add `putIfNotExists()` to `TableRepository` (Pattern 1) and `guardedWrite()` to `lambda-utils` (Pattern 3). Migrate all 11 event listeners, 2 BFF pipes with internal guards, 3 lifecycle services, and 2 controller handlers to use event-derived keys. Delete `IdempotencyGuard` last.

**Tech Stack:** TypeScript, AWS SDK v3 (`@aws-sdk/lib-dynamodb`, `@aws-sdk/client-dynamodb`), DynamoDB conditional writes, Jest

**Spec:** `docs/superpowers/specs/2026-03-15-remove-idempotency-guard-design.md`

---

## File Structure

### New files
- `libs/platform-core/test/repositories/table.repository.put-if-not-exists.test.ts` — unit tests for `putIfNotExists`
- `libs/lambda-utils/src/guarded-write.ts` — `guardedWrite()` utility
- `libs/lambda-utils/test/guarded-write.test.ts` — unit tests for `guardedWrite`

### Modified files (libs)
- `libs/platform-core/src/repositories/table.repository.ts` — add `putIfNotExists()` method
- `libs/lambda-utils/src/index.ts` — export `guardedWrite`, remove `IdempotencyGuard` export (cleanup phase)

### Modified files (BFF services — event listeners)
- `services/investor/investor-bff/src/handlers/event-listener.ts`
- `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- `services/ledger/ledger-bff/src/handlers/event-listener.ts`

### Modified files (BFF pipes with internal guards)
- `services/investor/investor-bff/src/pipes/user-registered.pipe.ts`
- `services/advisory/advisory-bff/src/pipes/decision-packet-created.pipe.ts`

### Modified files (BFF repositories — add sourceEventId + putIfNotExists)
- `services/investor/investor-bff/src/repositories/investor-profile.repository.ts` — `createProfile` → `putIfNotExists`
- `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts` — `addActivity` key change + `putIfNotExists`

### Modified files (controller event listeners)
- `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- `services/investor/investor-ctrl/src/handlers/event-listener.ts`

### Modified files (lifecycle services — getUUID → event-derived IDs)
- `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`
- `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`
- `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`
- `services/advisory/compliance-ctrl/src/handlers/event-listener.ts` (processDecisionPacket inline)

### Modified files (high-risk services)
- `services/execution/execution-adpt/src/handlers/event-listener.ts`
- `services/execution/execution-adpt/src/services/simulation-engine.service.ts`
- `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`
- `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- `services/ledger/reconciliation-ctrl/src/services/reconciliation.service.ts`

### Deleted files (cleanup)
- `libs/lambda-utils/src/idempotency.ts`
- `libs/lambda-utils/test/idempotency.test.ts`

### Modified test files (per service — remove idempotencyGuard mocks)
- All 11 `event-listener.test.ts` files
- `services/investor/investor-bff/test/pipes/user-registered.pipe.test.ts`
- `services/advisory/advisory-bff/test/pipes/decision-packet-created.pipe.test.ts`

---

## Chunk 1: Shared Library Additions (additive, no breaking changes)

### Task 1: Add `putIfNotExists` to `TableRepository`

**Files:**
- Modify: `libs/platform-core/src/repositories/table.repository.ts:28-36`
- Create: `libs/platform-core/test/repositories/table.repository.put-if-not-exists.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `libs/platform-core/test/repositories/table.repository.put-if-not-exists.test.ts`:

```typescript
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { TableRepository } from '../../src/repositories/table.repository';

jest.mock('../../src/logger', () => ({
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

class TestRepository extends TableRepository {
  async tryPut(item: Record<string, unknown>): Promise<boolean> {
    return this.putIfNotExists(item);
  }
}

describe('TableRepository.putIfNotExists', () => {
  let repo: TestRepository;
  let mockSend: jest.Mock;

  beforeEach(() => {
    mockSend = jest.fn();
    const mockClient = { send: mockSend } as unknown as DynamoDBClient;
    jest.spyOn(DynamoDBDocumentClient, 'from').mockReturnValue({
      send: mockSend,
    } as unknown as DynamoDBDocumentClient);
    repo = new TestRepository('test-table', mockClient);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return true when item is created (first write)', async () => {
    mockSend.mockResolvedValueOnce({});
    const item = { pk: 'Profile#t1#u1', sk: 'InvestorProfile', __typename: 'InvestorProfile' };

    const result = await repo.tryPut(item);

    expect(result).toBe(true);
    const command = mockSend.mock.calls[0][0];
    expect(command).toBeInstanceOf(PutCommand);
    expect(command.input.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(command.input.Item).toEqual(item);
  });

  it('should return false when item already exists (ConditionalCheckFailedException)', async () => {
    const error = new Error('The conditional request failed');
    error.name = 'ConditionalCheckFailedException';
    mockSend.mockRejectedValueOnce(error);

    const result = await repo.tryPut({ pk: 'Profile#t1#u1', sk: 'InvestorProfile' });

    expect(result).toBe(false);
  });

  it('should re-throw non-conditional DynamoDB errors', async () => {
    const error = new Error('Service unavailable');
    error.name = 'InternalServerError';
    mockSend.mockRejectedValueOnce(error);

    await expect(repo.tryPut({ pk: 'x', sk: 'y' })).rejects.toThrow('Service unavailable');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test platform-core -- --testPathPattern="put-if-not-exists" --verbose`
Expected: FAIL — `this.putIfNotExists is not a function`

- [ ] **Step 3: Implement `putIfNotExists` in `TableRepository`**

In `libs/platform-core/src/repositories/table.repository.ts`, add this method after the existing `put` method (after line 36):

```typescript
  @log()
  protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: item,
          ConditionExpression: 'attribute_not_exists(pk)',
        }),
      );
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx nx test platform-core -- --testPathPattern="put-if-not-exists" --verbose`
Expected: 3 tests PASS

- [ ] **Step 5: Run all platform-core tests to verify no regressions**

Run: `npx nx test platform-core --verbose`
Expected: All existing tests still pass

- [ ] **Step 6: Commit**

```bash
git add libs/platform-core/src/repositories/table.repository.ts libs/platform-core/test/repositories/table.repository.put-if-not-exists.test.ts
git commit -m "feat(platform-core): add putIfNotExists to TableRepository"
```

---

### Task 2: Add `guardedWrite` utility to lambda-utils

**Files:**
- Create: `libs/lambda-utils/src/guarded-write.ts`
- Create: `libs/lambda-utils/test/guarded-write.test.ts`
- Modify: `libs/lambda-utils/src/index.ts:20`

- [ ] **Step 1: Write the failing tests**

Create `libs/lambda-utils/test/guarded-write.test.ts`:

```typescript
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { guardedWrite } from '../src/guarded-write';

describe('guardedWrite', () => {
  let mockDocClient: { send: jest.Mock };

  beforeEach(() => {
    mockDocClient = { send: jest.fn() };
  });

  it('should return true on first call (guard marker created)', async () => {
    mockDocClient.send.mockResolvedValueOnce({});

    const result = await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'Dashboard#t1', sk: 'ProcessedEvent#evt-1#portfolioSummary' },
      [
        {
          Update: {
            TableName: 'test-table',
            Key: { pk: 'Dashboard#t1', sk: 'PortfolioSummary' },
            UpdateExpression: 'SET totalValueCents = if_not_exists(totalValueCents, :zero) + :delta',
            ExpressionAttributeValues: { ':zero': 0, ':delta': 5000 },
          },
        },
      ],
    );

    expect(result).toBe(true);
    expect(mockDocClient.send).toHaveBeenCalledTimes(1);
    const command = mockDocClient.send.mock.calls[0][0];
    expect(command).toBeInstanceOf(TransactWriteCommand);

    // First TransactItem should be the guard marker with condition
    const items = command.input.TransactItems;
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(pk)');
    expect(items[0].Put.Item.pk).toBe('Dashboard#t1');
    expect(items[0].Put.Item.sk).toBe('ProcessedEvent#evt-1#portfolioSummary');
    expect(items[0].Put.Item.__typename).toBe('ProcessedEvent');
    expect(items[0].Put.Item.ttl).toBeGreaterThan(0);

    // Second item should be the business operation
    expect(items[1].Update).toBeDefined();
  });

  it('should return false when guard marker already exists (duplicate)', async () => {
    const cancelledError = new Error('Transaction cancelled');
    cancelledError.name = 'TransactionCanceledException';
    (cancelledError as any).CancellationReasons = [
      { Code: 'ConditionalCheckFailed' },
      { Code: 'None' },
    ];
    mockDocClient.send.mockRejectedValueOnce(cancelledError);

    const result = await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'Dashboard#t1', sk: 'ProcessedEvent#evt-1#portfolioSummary' },
      [{ Update: { TableName: 'test-table', Key: { pk: 'x', sk: 'y' }, UpdateExpression: 'SET a = :a', ExpressionAttributeValues: { ':a': 1 } } }],
    );

    expect(result).toBe(false);
  });

  it('should re-throw when TransactionCanceledException is NOT caused by guard marker', async () => {
    const cancelledError = new Error('Transaction cancelled');
    cancelledError.name = 'TransactionCanceledException';
    (cancelledError as any).CancellationReasons = [
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' },
    ];
    mockDocClient.send.mockRejectedValueOnce(cancelledError);

    await expect(
      guardedWrite(
        mockDocClient as unknown as DynamoDBDocumentClient,
        'test-table',
        { pk: 'x', sk: 'y' },
        [{ Update: { TableName: 'test-table', Key: { pk: 'a', sk: 'b' }, UpdateExpression: 'SET a = :a', ExpressionAttributeValues: { ':a': 1 } } }],
      ),
    ).rejects.toThrow('Transaction cancelled');
  });

  it('should re-throw non-TransactionCanceledException errors', async () => {
    const error = new Error('DynamoDB unavailable');
    error.name = 'InternalServerError';
    mockDocClient.send.mockRejectedValueOnce(error);

    await expect(
      guardedWrite(
        mockDocClient as unknown as DynamoDBDocumentClient,
        'test-table',
        { pk: 'x', sk: 'y' },
        [],
      ),
    ).rejects.toThrow('DynamoDB unavailable');
  });

  it('should accept custom TTL (default is 86400)', async () => {
    mockDocClient.send.mockResolvedValueOnce({});
    const nowSeconds = Math.floor(Date.now() / 1000);

    await guardedWrite(
      mockDocClient as unknown as DynamoDBDocumentClient,
      'test-table',
      { pk: 'x', sk: 'y' },
      [],
      604800, // 7 days for financial operations
    );

    const command = mockDocClient.send.mock.calls[0][0];
    const ttl = command.input.TransactItems[0].Put.Item.ttl;
    expect(ttl).toBeGreaterThanOrEqual(nowSeconds + 604800 - 5);
    expect(ttl).toBeLessThanOrEqual(nowSeconds + 604800 + 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test lambda-utils -- --testPathPattern="guarded-write" --verbose`
Expected: FAIL — cannot find module `../src/guarded-write`

- [ ] **Step 3: Implement `guardedWrite`**

Create `libs/lambda-utils/src/guarded-write.ts`:

```typescript
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';

const DEFAULT_TTL_SECONDS = 86400; // 24 hours

/**
 * Atomically writes a guard marker + business operations in a single DynamoDB transaction.
 * If the guard marker already exists (duplicate event), returns false and skips the business writes.
 *
 * Used for additive operations (ADD/increment) where replaying doubles the effect.
 *
 * @param guardKey - pk/sk for the guard marker. Use the business entity's pk + `ProcessedEvent#${eventId}` sk.
 * @param transactItems - The business operations to execute atomically with the guard.
 * @param ttlSeconds - TTL for the guard marker (default 24h; use 604800 for financial operations).
 * @returns true if the transaction succeeded (first time), false if guard marker exists (duplicate).
 */
export async function guardedWrite(
  docClient: DynamoDBDocumentClient,
  tableName: string,
  guardKey: { pk: string; sk: string },
  transactItems: Record<string, unknown>[],
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<boolean> {
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: tableName,
              Item: {
                ...guardKey,
                __typename: 'ProcessedEvent',
                ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
              },
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          ...transactItems,
        ],
      }),
    );
    return true;
  } catch (error: unknown) {
    if (error instanceof TransactionCanceledException) {
      if (error.CancellationReasons?.[0]?.Code === 'ConditionalCheckFailed') {
        return false; // guard marker exists — skip
      }
    }
    throw error;
  }
}
```

- [ ] **Step 4: Export `guardedWrite` from lambda-utils index**

In `libs/lambda-utils/src/index.ts`, add after line 20 (the `IdempotencyGuard` export):

```typescript
export { guardedWrite } from './guarded-write';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test lambda-utils -- --testPathPattern="guarded-write" --verbose`
Expected: 5 tests PASS

- [ ] **Step 6: Run all lambda-utils tests to verify no regressions**

Run: `npx nx test lambda-utils --verbose`
Expected: All existing tests still pass (including idempotency tests — not deleted yet)

- [ ] **Step 7: Commit**

```bash
git add libs/lambda-utils/src/guarded-write.ts libs/lambda-utils/test/guarded-write.test.ts libs/lambda-utils/src/index.ts
git commit -m "feat(lambda-utils): add guardedWrite utility for atomic event deduplication"
```

---

## Chunk 2: BFF Services (lowest risk — read-model materialization)

### Task 3: Migrate investor-bff — Remove IdempotencyGuard from event listener and UserRegisteredPipe

**Files:**
- Modify: `services/investor/investor-bff/src/pipes/user-registered.pipe.ts`
- Modify: `services/investor/investor-bff/src/repositories/investor-profile.repository.ts:31-54`
- Modify: `services/investor/investor-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-bff/test/handlers/event-listener.test.ts`
- Modify: `services/investor/investor-bff/test/pipes/user-registered.pipe.test.ts`

- [ ] **Step 1: Change `createProfile` to use `putIfNotExists` in repository**

In `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`, change the `createProfile` method to return a `boolean` and use `putIfNotExists`:

```typescript
  readonly createProfile = this.log('createProfile',
    async (tenantId: string, userId: string, email: string, sourceEventId: string): Promise<boolean> => {
      const now = getTime();
      const item: TableEntry = {
        pk: profilePk(tenantId, userId),
        sk: 'InvestorProfile',
        __typename: 'InvestorProfile',
        tenantId,
        timestamp: now,
        userId,
        name: '',
        email,
        age: 0,
        locale: 'en',
        operatingMode: 'BALANCED',
        monthlyContributionCents: 0,
        currency: 'USD',
        onboardingCompletedAt: null,
        sourceEventId,
        createdAt: now,
        updatedAt: now,
      };
      return this.putIfNotExists(item);
    },
  );
```

- [ ] **Step 2: Simplify `UserRegisteredPipe` — remove IdempotencyGuard**

Replace `services/investor/investor-bff/src/pipes/user-registered.pipe.ts`:

```typescript
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { InvestorProfileRepository } from '../repositories/investor-profile.repository';

type UserRegisteredPayload = {
  userId: string;
  tenantId: string;
  email: string;
};

export class UserRegisteredPipe implements Pipe<UnitOfWork<BusEvent<UserRegisteredPayload>>> {
  constructor(private readonly repository: InvestorProfileRepository) {}

  async process(uow: UnitOfWork<BusEvent<UserRegisteredPayload>>): Promise<void> {
    const { event } = uow;
    const { userId, tenantId, email } = event.subject;

    const created = await this.repository.createProfile(tenantId, userId, email, event.id);
    if (!created) {
      logger.info('Profile already exists, skipping', { eventId: event.id });
      return;
    }

    logger.info('Created InvestorProfile skeleton', { tenantId, userId });
  }
}
```

- [ ] **Step 3: Change `addNotification` to use `putIfNotExists`**

In `services/investor/investor-bff/src/repositories/investor-profile.repository.ts`, change `addNotification` to return `boolean` and use `putIfNotExists`:

```typescript
  readonly addNotification = this.log('addNotification',
    async (
      tenantId: string,
      userId: string,
      notification: {
        notificationId: string;
        channel: string;
        title: string;
        body: string;
        relatedEntityType: string;
        relatedEntityId: string;
      },
      sourceEventId: string,
    ): Promise<boolean> => {
      const pk = profilePk(tenantId, userId);
      const now = getTime();

      const item: TableEntry = {
        pk,
        sk: `Notification#${notification.notificationId}`,
        __typename: 'Notification',
        tenantId,
        timestamp: now,
        notificationId: notification.notificationId,
        channel: notification.channel,
        title: notification.title,
        body: notification.body,
        status: 'CREATED',
        relatedEntityType: notification.relatedEntityType,
        relatedEntityId: notification.relatedEntityId,
        sourceEventId,
        createdAt: now,
        sentAt: null,
        deliveredAt: null,
        readAt: null,
      };

      return this.putIfNotExists(item);
    },
  );
```

- [ ] **Step 4: Remove IdempotencyGuard from event listener**

In `services/investor/investor-bff/src/handlers/event-listener.ts`:

1. Remove `IdempotencyGuard` from the import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove the `ensureOnce` check (lines 43-47)
4. Remove `idempotencyGuard` from production wiring (line 93-98)
5. Change `UserRegisteredPipe` constructor — no longer passes `idempotencyGuard`

The event listener should call pipes directly (idempotency is now inside the repository writes):

```typescript
// In the production wiring section:
const deps: EventListenerDeps = {
  repository,
  userRegisteredPipe: new UserRegisteredPipe(repository),
  notificationCreatedPipe: new NotificationCreatedPipe(repository),
  balanceUpdatedPipe: new BalanceUpdatedPipe(repository),
  bus: new EventBridgeBus(requireEnv('BUS_NAME'), 'investor-bff'),
  metrics: createServiceMetrics('investor-bff'),
};
```

Remove the `ensureOnce` block from `createHandler`. The new handler loop body:

```typescript
        if (!TRIGGER_EVENT_TYPES.has(eventType)) {
          logger.warn('No handler for event type, skipping', { eventType });
          continue;
        }

        await processEvent(deps, eventType, uow);
        deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
```

- [ ] **Step 5: Update event listener tests**

In `services/investor/investor-bff/test/handlers/event-listener.test.ts`:
- Remove mock for `IdempotencyGuard` from the `jest.mock('@nestfolio/lambda-utils', ...)` block
- Remove `idempotencyGuard` from deps construction
- Update "duplicate event" test: instead of mocking `ensureOnce` returning `false`, verify that when the pipe's repository method returns `false` (putIfNotExists duplicate), the pipe handles it gracefully (no error thrown, processing continues)
- Verify `NotificationCreatedPipe` callers pass `sourceEventId`

- [ ] **Step 6: Update pipe tests**

In `services/investor/investor-bff/test/pipes/user-registered.pipe.test.ts`:
- Remove `IdempotencyGuard` constructor arg
- Change `createProfile` mock to return `true` (for normal case) and `false` (for duplicate case)
- Add test for duplicate: mock `createProfile` returning `false`, verify no error thrown
- Update `createProfile` call assertions to include `sourceEventId` parameter

- [ ] **Step 7: Run tests**

Run: `npx nx test investor-bff --verbose`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add services/investor/investor-bff/
git commit -m "refactor(investor-bff): replace IdempotencyGuard with putIfNotExists conditional writes"
```

---

### Task 4: Migrate advisory-bff — Remove IdempotencyGuard from event listener and DecisionPacketCreatedPipe

**Files:**
- Modify: `services/advisory/advisory-bff/src/pipes/decision-packet-created.pipe.ts`
- Modify: `services/advisory/advisory-bff/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-bff/test/event-listener.test.ts`
- Modify: `services/advisory/advisory-bff/test/pipes/decision-packet-created.pipe.test.ts`

- [ ] **Step 1: Simplify DecisionPacketCreatedPipe — remove IdempotencyGuard**

Replace `services/advisory/advisory-bff/src/pipes/decision-packet-created.pipe.ts`:

```typescript
import { type Pipe, type UnitOfWork, type BusEvent, logger } from '@nestfolio/platform-core';
import { AdvisoryRepository } from '../repositories/advisory.repository';

type DecisionPacketCreatedPayload = {
  tenantId: string;
  decisionId: string;
  trigger: string;
  proposedTrades: unknown[];
  explanation: string;
  confirmationRequired: boolean;
};

export class DecisionPacketCreatedPipe
  implements Pipe<UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>>
{
  constructor(private readonly repository: AdvisoryRepository) {}

  async process(
    uow: UnitOfWork<BusEvent<DecisionPacketCreatedPayload>>,
  ): Promise<void> {
    const { event } = uow;
    const payload = event.subject;

    const created = await this.repository.storeDecision(payload.tenantId, payload.decisionId, {
      trigger: payload.trigger,
      proposedTrades: payload.proposedTrades,
      explanation: payload.explanation,
      confirmationRequired: payload.confirmationRequired,
      complianceChecks: [],
      agentInvocations: [],
      sourceEventId: event.id,
    });

    if (!created) {
      logger.info('Decision already stored, skipping', { eventId: event.id, decisionId: payload.decisionId });
      return;
    }

    logger.info('Stored decision read model', {
      tenantId: payload.tenantId,
      decisionId: payload.decisionId,
    });
  }
}
```

Note: `storeDecision` in `AdvisoryRepository` needs to be updated to use `putIfNotExists` and return `boolean`. The key uses `decisionId` from payload which is already deterministic.

- [ ] **Step 2: Update `storeDecision` in `AdvisoryRepository` to use `putIfNotExists`**

Change the method signature to return `Promise<boolean>` and use `this.putIfNotExists(item)` instead of `this.put(item)`. Add `sourceEventId` to the item.

- [ ] **Step 3: Remove IdempotencyGuard from advisory-bff event listener**

In `services/advisory/advisory-bff/src/handlers/event-listener.ts`:
1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove the `ensureOnce` check (lines 42-46)
4. Update production wiring — remove `idempotencyGuard` dep, change `DecisionPacketCreatedPipe` constructor (no longer passes `idempotencyGuard`)

- [ ] **Step 4: Update tests**

In `services/advisory/advisory-bff/test/event-listener.test.ts`:
- Remove `idempotencyGuard` mock and deps
- Update duplicate test cases

In `services/advisory/advisory-bff/test/pipes/decision-packet-created.pipe.test.ts`:
- Remove `IdempotencyGuard` constructor arg
- Change `storeDecision` mock to return `boolean`
- Add duplicate test

- [ ] **Step 5: Run tests**

Run: `npx nx test advisory-bff --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-bff/
git commit -m "refactor(advisory-bff): replace IdempotencyGuard with putIfNotExists conditional writes"
```

---

### Task 5: Migrate dashboard-bff — Remove per-pipe IdempotencyGuard, add `guardedWrite` for additive pipes

**Files:**
- Modify: `services/investor/dashboard-bff/src/handlers/event-listener.ts`
- Modify: `services/investor/dashboard-bff/src/pipes/portfolio-summary.pipe.ts`
- Modify: `services/investor/dashboard-bff/src/pipes/advisory-status.pipe.ts`
- Modify: `services/investor/dashboard-bff/src/pipes/recent-activity.pipe.ts`
- Modify: `services/investor/dashboard-bff/src/repositories/dashboard.repository.ts`
- Modify: `services/investor/dashboard-bff/test/handlers/event-listener.test.ts`

This is the most complex BFF because it has three different patterns:

- **PortfolioSummaryPipe**: Pattern 3 (additive — `atomicIncrementTotalValue`) → needs `guardedWrite`
- **AdvisoryStatusPipe**: Pattern 3 (additive — `pendingDecisionsDelta`) → needs `guardedWrite`
- **RecentActivityPipe**: Pattern 1 (create) → change key + `putIfNotExists`
- **PositionSnapshotPipe, InvestorSnapshotPipe, TimeTravelAvailabilityPipe, SimulationSummaryPipe**: Pattern 2 (upsert) → no change needed

- [ ] **Step 1: Update `addActivity` in `DashboardRepository`**

Change `addActivity` to accept `eventId` and use it in the sort key (preserving chronological ordering with timestamp prefix), and use `putIfNotExists`:

```typescript
  readonly addActivity = this.log('addActivity',
    async (
      tenantId: string,
      eventId: string,
      activity: {
        activityType: string;
        description: string;
        metadata?: Record<string, unknown>;
      },
    ): Promise<boolean> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const TTL_90_DAYS = 90 * 24 * 60 * 60;
      const expiresAt = Math.floor(Date.now() / 1000) + TTL_90_DAYS;

      const item: TableEntry = {
        pk,
        sk: `Activity#${now}#${eventId}`,
        __typename: 'RecentActivity',
        tenantId,
        timestamp: now,
        activityType: activity.activityType,
        description: activity.description,
        metadata: activity.metadata ? JSON.stringify(activity.metadata) : null,
        sourceEventId: eventId,
        ttl: expiresAt,
      };

      return this.putIfNotExists(item);
    },
  );
```

Note: The sort key keeps the `${now}` prefix to preserve chronological ordering for `getRecentActivity` queries (which use `ScanIndexForward: false`), while appending `${eventId}` instead of `${getUUID()}` for determinism.

Remove `getUUID` import if no longer used in this file.

- [ ] **Step 2: Update `RecentActivityPipe` to pass `eventId`**

In `services/investor/dashboard-bff/src/pipes/recent-activity.pipe.ts`, pass `event.id` to `addActivity`:

```typescript
    await this.repository.addActivity(tenantId, event.id, {
      activityType: event.type,
      description,
      metadata: payload,
    });
```

- [ ] **Step 3: Update `PortfolioSummaryPipe` to use `guardedWrite`**

The pipe needs access to `docClient` and `tableName` for `guardedWrite`. Pass the repository (which has these) or inject them. The cleanest approach: add a `guardedAtomicIncrement` method to `DashboardRepository` that combines the guard marker with the increment.

Add to `DashboardRepository`:

```typescript
  readonly guardedAtomicIncrementTotalValue = this.log('guardedAtomicIncrementTotalValue',
    async (
      tenantId: string,
      eventId: string,
      pipeName: string,
      deltaCents: number,
      extraUpdates?: Record<string, number>,
    ): Promise<boolean> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
        'totalValueCents = if_not_exists(totalValueCents, :zero) + :delta',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'PortfolioSummary',
        ':tenantId': tenantId,
        ':zero': 0,
        ':delta': deltaCents,
      };

      if (extraUpdates) {
        for (const [key, value] of Object.entries(extraUpdates)) {
          if (value !== undefined) {
            updateExpressions.push(`${key} = :${key}`);
            expressionValues[`:${key}`] = value;
          }
        }
      }

      return guardedWrite(
        this.docClient,
        this.tableName,
        { pk, sk: `ProcessedEvent#${eventId}#${pipeName}` },
        [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'PortfolioSummary' },
              UpdateExpression: `SET ${updateExpressions.join(', ')}`,
              ExpressionAttributeNames: expressionNames,
              ExpressionAttributeValues: expressionValues,
            },
          },
        ],
      );
    },
  );
```

Import `guardedWrite` from `@nestfolio/lambda-utils` at the top of the repository file.

- [ ] **Step 4: Update `PortfolioSummaryPipe` to use guarded method**

```typescript
  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;
    const payload = event.subject as OrderFilledPayload & Record<string, unknown>;

    const extraUpdates: Record<string, number> = {};

    if (payload.driftPercent !== undefined) {
      extraUpdates.driftPercent = payload.driftPercent as number;
    }

    if (payload.filledQuantity !== undefined && payload.averageFillPrice !== undefined) {
      const tradeValueCents = Math.round(
        payload.filledQuantity * payload.averageFillPrice * 100,
      );

      const processed = await this.repository.guardedAtomicIncrementTotalValue(
        tenantId, event.id, 'portfolioSummary', tradeValueCents, extraUpdates,
      );
      if (!processed) {
        logger.info('Portfolio summary already updated for this event, skipping', { eventId: event.id });
        return;
      }
    } else if (Object.keys(extraUpdates).length > 0) {
      await this.repository.upsertPortfolioSummary(tenantId, extraUpdates);
    }

    logger.info('Updated portfolio summary projection', {
      tenantId,
      eventType: event.type,
    });
  }
```

- [ ] **Step 5: Add `guardedUpsertAdvisoryStatus` to `DashboardRepository` for `AdvisoryStatusPipe`**

Same pattern as Step 3 — wraps the `pendingDecisionsDelta` ADD operation in a `guardedWrite`.

Add to `DashboardRepository`:

```typescript
  readonly guardedUpsertAdvisoryStatus = this.log('guardedUpsertAdvisoryStatus',
    async (
      tenantId: string,
      eventId: string,
      pipeName: string,
      updates: {
        pendingDecisionsDelta?: number;
        lastRecommendationAt?: string;
        lastDecisionStatus?: string;
      },
    ): Promise<boolean> => {
      const pk = dashboardPk(tenantId);
      const now = getTime();

      const updateExpressions: string[] = [
        '#ts = :ts',
        'updatedAt = :now',
        '__typename = :typename',
        'tenantId = :tenantId',
      ];
      const expressionNames: Record<string, string> = { '#ts': 'timestamp' };
      const expressionValues: Record<string, unknown> = {
        ':ts': now,
        ':now': now,
        ':typename': 'AdvisoryStatus',
        ':tenantId': tenantId,
      };

      if (updates.pendingDecisionsDelta !== undefined) {
        updateExpressions.push('pendingDecisionsCount = if_not_exists(pendingDecisionsCount, :zero) + :delta');
        expressionValues[':delta'] = updates.pendingDecisionsDelta;
        expressionValues[':zero'] = 0;
      }

      if (updates.lastRecommendationAt !== undefined) {
        updateExpressions.push('lastRecommendationAt = :lastRecommendationAt');
        expressionValues[':lastRecommendationAt'] = updates.lastRecommendationAt;
      }

      if (updates.lastDecisionStatus !== undefined) {
        updateExpressions.push('lastDecisionStatus = :lastDecisionStatus');
        expressionValues[':lastDecisionStatus'] = updates.lastDecisionStatus;
      }

      return guardedWrite(
        this.docClient,
        this.tableName,
        { pk, sk: `ProcessedEvent#${eventId}#${pipeName}` },
        [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: 'AdvisoryStatus' },
              UpdateExpression: `SET ${updateExpressions.join(', ')}`,
              ExpressionAttributeNames: expressionNames,
              ExpressionAttributeValues: expressionValues,
            },
          },
        ],
      );
    },
  );
```

- [ ] **Step 6: Update `AdvisoryStatusPipe` to use guarded method**

```typescript
  async process(uow: UnitOfWork<BusEvent<Record<string, unknown>>>): Promise<void> {
    const { event } = uow;
    const tenantId = (event.context as Record<string, string>).tenantId;

    let processed: boolean;

    switch (event.type) {
      case 'DECISION_PACKET_CREATED':
      case 'USER_CONFIRMATION_REQUESTED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: 1, lastRecommendationAt: event.timestamp },
        );
        break;

      case 'DECISION_APPROVED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: -1, lastDecisionStatus: 'APPROVED' },
        );
        break;

      case 'DECISION_BLOCKED':
        processed = await this.repository.guardedUpsertAdvisoryStatus(
          tenantId, event.id, 'advisoryStatus',
          { pendingDecisionsDelta: -1, lastDecisionStatus: 'BLOCKED' },
        );
        break;

      default:
        processed = true;
        break;
    }

    if (!processed) {
      logger.info('Advisory status already updated for this event, skipping', { eventId: event.id });
      return;
    }

    logger.info('Updated advisory status projection', {
      tenantId,
      eventType: event.type,
    });
  }
```

- [ ] **Step 7: Remove per-pipe idempotency from dashboard-bff event listener**

In `services/investor/dashboard-bff/src/handlers/event-listener.ts`:
1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Replace the `processEvent` function — remove the per-pipe `ensureOnce` loop. Just call pipes directly:

```typescript
async function processEvent(
  deps: EventListenerDeps,
  eventType: string,
  uow: UnitOfWork<BusEvent<Record<string, unknown>>>,
): Promise<void> {
  const namedPipes = deps.eventPipeMap[eventType];

  if (!namedPipes || namedPipes.length === 0) {
    logger.info('No pipes for event type, skipping', { eventType });
    return;
  }

  for (const { pipe } of namedPipes) {
    await pipe.process(uow);
  }
}
```

4. Remove `idempotencyGuard` from production wiring

- [ ] **Step 8: Update tests**

Update event listener test — remove `idempotencyGuard` mocks. Update pipe tests for new method signatures.

- [ ] **Step 9: Run tests**

Run: `npx nx test dashboard-bff --verbose`
Expected: All tests pass

- [ ] **Step 10: Commit**

```bash
git add services/investor/dashboard-bff/
git commit -m "refactor(dashboard-bff): replace IdempotencyGuard with putIfNotExists and guardedWrite"
```

---

### Task 6: Migrate ledger-bff — Remove per-pipe IdempotencyGuard

**Files:**
- Modify: `services/ledger/ledger-bff/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-bff/test/handlers/event-listener.test.ts`

This is the simplest BFF — all 3 pipes (BalanceUpdatedPipe, PortfolioUpdatedPipe, LedgerEntryRecordedPipe) are Pattern 2 (upsert). No pipe changes needed.

- [ ] **Step 1: Remove per-pipe idempotency from event listener**

In `services/ledger/ledger-bff/src/handlers/event-listener.ts`:
1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Replace `processEvent` function — remove per-pipe `ensureOnce` loop, just call pipes directly (same pattern as dashboard-bff Step 7)
4. Remove `idempotencyGuard` from production wiring

- [ ] **Step 2: Update tests**

Remove `idempotencyGuard` mock from test file. Remove duplicate-event test cases that mock `ensureOnce`.

- [ ] **Step 3: Run tests**

Run: `npx nx test ledger-bff --verbose`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add services/ledger/ledger-bff/
git commit -m "refactor(ledger-bff): remove IdempotencyGuard (all pipes are idempotent upserts)"
```

---

## Chunk 3: Controller Services (medium risk — replace getUUID with event-derived IDs)

### Task 7: Migrate advisory-ctrl — event-derived decision packet ID

**Files:**
- Modify: `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`
- Modify: `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/advisory-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Update DecisionLifecycleService — derive dpId from event**

In `services/advisory/advisory-ctrl/src/services/decision-lifecycle.service.ts`:
1. Change `executeDecisionLifecycle` to accept the trigger event and use `context.triggerEvent.id` as the `dpId`:

```typescript
  readonly executeDecisionLifecycle = this.log('executeDecisionLifecycle', async (context: DecisionContext): Promise<DecisionResult> => {
    const dpId = context.triggerEvent.id;

    // 1. Create decision packet (now uses putIfNotExists)
    const created = await this.repository.createDecisionPacket(
      context.tenantId,
      dpId,
      context.triggerEvent,
      context as unknown as Record<string, unknown>,
    );

    if (!created) {
      logger.info('Decision packet already exists, skipping', { dpId });
      return {
        decisionPacketId: dpId,
        status: 'COMPLETED',
        agentOutputs: {},
        proposedTrades: [],
        explanation: 'Duplicate event — already processed.',
      };
    }
    // ... rest unchanged
  });
```

2. Remove `getUUID` import (if no longer used)

- [ ] **Step 2: Update `createDecisionPacket` in `DecisionRepository`**

Change to use `putIfNotExists` and return `boolean`. Add `sourceEventId` to the item.

- [ ] **Step 3: Remove IdempotencyGuard from advisory-ctrl event listener**

In `services/advisory/advisory-ctrl/src/handlers/event-listener.ts`:
1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove the `ensureOnce` check (lines 61-65)
4. Remove `idempotencyGuard` from production wiring

- [ ] **Step 4: Update tests**

Remove `idempotencyGuard` mock and deps from test file. Add test case for duplicate event: mock `createDecisionPacket` returning `false`, verify early return.

- [ ] **Step 5: Run tests**

Run: `npx nx test advisory-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/advisory/advisory-ctrl/
git commit -m "refactor(advisory-ctrl): derive decision packet ID from event, remove IdempotencyGuard"
```

---

### Task 8: Migrate compliance-ctrl — event-derived compliance check and audit artifact IDs

**Files:**
- Modify: `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`
- Modify: `services/advisory/compliance-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Update `processDecisionPacket` — derive IDs from event**

In `services/advisory/compliance-ctrl/src/handlers/event-listener.ts`, change the `processDecisionPacket` function:
1. `ccId = getUUID()` → `ccId = event.id as string`
2. `artifactId = getUUID()` → `artifactId = (event.id as string) + '-audit'`
3. Change `createComplianceCheck` to use `putIfNotExists` (update repository). If it returns `false`, return early.
4. Change `createAuditArtifact` to use `putIfNotExists` (update repository)
5. Add `sourceEventId: event.id` to both records

Also update the "no mandate" branch (line 107) to use `event.id as string` for `ccId`.

- [ ] **Step 2: Update `ComplianceRepository`**

Change `createComplianceCheck` and `createAuditArtifact` to use `putIfNotExists` and return `boolean`.

- [ ] **Step 3: Remove IdempotencyGuard from compliance-ctrl event listener**

1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove `ensureOnce` check (lines 54-58)
4. Remove `idempotencyGuard` from production wiring
5. Remove `getUUID` import (use `event.id` instead)

- [ ] **Step 4: Update tests**

Remove `idempotencyGuard` mock. Add test for duplicate: mock `createComplianceCheck` returning `false`.

- [ ] **Step 5: Run tests**

Run: `npx nx test compliance-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/advisory/compliance-ctrl/
git commit -m "refactor(compliance-ctrl): derive check/artifact IDs from event, remove IdempotencyGuard"
```

---

### Task 9: Migrate execution-ctrl — event-derived order ID

**Files:**
- Modify: `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`
- Modify: `services/execution/execution-ctrl/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Update OrderLifecycleService — derive orderId from event**

In `services/execution/execution-ctrl/src/services/order-lifecycle.service.ts`:
1. Change `processApprovedDecision` to accept the full event (not just BusEvent) and derive `orderId` from `event.id`:

```typescript
  readonly processApprovedDecision = this.log('processApprovedDecision',
    async (event: BusEvent): Promise<void> => {
      const { tenantId, decisionPacketId, proposedTrades } = this.extractFromEvent(event);
      const orderId = event.id;

      // 1. Create order record (now uses putIfNotExists)
      const created = await this.repository.createOrder(tenantId, orderId, decisionPacketId, proposedTrades);
      if (!created) {
        logger.info('Order already exists, skipping duplicate', { orderId });
        return;
      }
      // ... rest unchanged
    },
  );
```

2. Remove `getUUID` import
3. Update `createOrder` in `OrderRepository` to use `putIfNotExists` and return `boolean`

- [ ] **Step 2: Remove IdempotencyGuard from execution-ctrl event listener**

1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove `ensureOnce` check (lines 43-47)
4. Remove `idempotencyGuard` from production wiring

- [ ] **Step 3: Update tests**

Remove `idempotencyGuard` mock. Add test for duplicate: mock `createOrder` returning `false`.

- [ ] **Step 4: Run tests**

Run: `npx nx test execution-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add services/execution/execution-ctrl/
git commit -m "refactor(execution-ctrl): derive order ID from event, remove IdempotencyGuard"
```

---

### Task 10: Migrate investor-ctrl — event-derived notification and report IDs

**Files:**
- Modify: `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`
- Modify: `services/investor/investor-ctrl/src/handlers/event-listener.ts`
- Modify: `services/investor/investor-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Update NotificationLifecycleService — derive IDs from event**

In `services/investor/investor-ctrl/src/services/notification-lifecycle.service.ts`:
1. `notificationId = getUUID()` → `notificationId = context.triggerEvent.id`
2. `reportId = getUUID()` → `reportId = context.triggerEvent.id + '-report'`
3. Change `createNotification` to use `putIfNotExists` and return `boolean`. If `false`, return early.
4. Change `createMonthlyReport` to use `putIfNotExists` and return `boolean`. If `false`, skip report.
5. Remove `getUUID` import

- [ ] **Step 2: Update `NotificationRepository`**

Change `createNotification` and `createMonthlyReport` to use `putIfNotExists` and return `boolean`.

- [ ] **Step 3: Remove IdempotencyGuard from investor-ctrl event listener**

1. Remove `IdempotencyGuard` from import
2. Remove `idempotencyGuard` from `EventListenerDeps` interface
3. Remove `ensureOnce` check (lines 44-48)
4. Remove `idempotencyGuard` from production wiring

- [ ] **Step 4: Update tests**

Remove `idempotencyGuard` mock. Add test for duplicate: mock `createNotification` returning `false`.

- [ ] **Step 5: Run tests**

Run: `npx nx test investor-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/investor/investor-ctrl/
git commit -m "refactor(investor-ctrl): derive notification/report IDs from event, remove IdempotencyGuard"
```

---

### Task 11: Migrate reconciliation-ctrl — event-derived reconciliation ID

**Files:**
- Modify: `services/ledger/reconciliation-ctrl/src/services/reconciliation.service.ts`
- Modify: `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/reconciliation-ctrl/test/event-listener.test.ts`

- [ ] **Step 1: Update ReconciliationService — accept reconciliationId as parameter**

In `services/ledger/reconciliation-ctrl/src/services/reconciliation.service.ts`:
1. Change `reconcile` to accept `reconciliationId` as a parameter instead of generating via `getUUID()`
2. Change `createReconciliation` to use `putIfNotExists` and return `boolean`. If `false`, return early.
3. Change `createDriftRecord` key derivation: `${reconciliationId}-${instrument}` with `putIfNotExists`
4. Remove `getUUID` import

```typescript
  readonly reconcile = this.log('reconcile',
    async (reconciliationId: string, input: ReconciliationInput): Promise<ReconciliationResult> => {
      const created = await this.repository.createReconciliation(
        input.tenantId,
        reconciliationId,
        'MANUAL',
      );

      if (!created) {
        logger.info('Reconciliation already exists, skipping', { reconciliationId });
        return { reconciliationId, status: 'COMPLETED', driftRecords: [] };
      }
      // ... rest unchanged, but createDriftRecord also uses putIfNotExists
    },
  );
```

- [ ] **Step 2: Update event listener to pass `uow.event.id` as reconciliation ID**

In `services/ledger/reconciliation-ctrl/src/handlers/event-listener.ts`:
1. Remove `IdempotencyGuard` from import + deps + `ensureOnce` check + wiring
2. Pass `uow.event.id` to the reconciliation service:

```typescript
        await deps.reconciliationService.reconcile(uow.event.id, {
          tenantId,
          portfolioId,
          intentPositions: positions.map(/* ... */),
          settlementPositions: positions.map(/* ... */),
        });
```

- [ ] **Step 3: Update `ReconciliationRepository`**

Change `createReconciliation` and `createDriftRecord` to use `putIfNotExists` and return `boolean`.

- [ ] **Step 4: Update tests**

Remove `idempotencyGuard` mock. Add duplicate test.

- [ ] **Step 5: Run tests**

Run: `npx nx test reconciliation-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add services/ledger/reconciliation-ctrl/
git commit -m "refactor(reconciliation-ctrl): derive reconciliation ID from event, remove IdempotencyGuard"
```

---

## Chunk 4: High-Risk Services (additive operations, ledger key restructuring)

### Task 12: Migrate execution-adpt — guardedWrite for deposits/withdrawals, deterministic trade ID

**Files:**
- Modify: `services/execution/execution-adpt/src/handlers/event-listener.ts`
- Modify: `services/execution/execution-adpt/src/services/simulation-engine.service.ts`
- Modify: `services/execution/execution-adpt/src/repositories/virtual-ledger.repository.ts`
- Modify: `services/execution/execution-adpt/test/event-listener.test.ts`

This is the highest-risk service — it has additive cash balance operations.

- [ ] **Step 1: Add `guardedAddToCashBalance` to `VirtualLedgerRepository`**

Add a new method that wraps `addToCashBalance` in a `guardedWrite`:

```typescript
  readonly guardedAddToCashBalance = this.log('guardedAddToCashBalance',
    async (
      tenantId: string,
      userId: string,
      currency: string,
      amount: number,
      eventId: string,
    ): Promise<boolean> => {
      const now = getTime();
      const pk = ledgerPk(tenantId, userId);
      return guardedWrite(
        this.docClient,
        this.tableName,
        { pk, sk: `ProcessedEvent#${eventId}` },
        [
          {
            Update: {
              TableName: this.tableName,
              Key: { pk, sk: `CashBalance#${currency}` },
              UpdateExpression: 'ADD balance :amount SET #ts = :ts, updatedAt = :now',
              ExpressionAttributeNames: { '#ts': 'timestamp' },
              ExpressionAttributeValues: { ':amount': amount, ':ts': now, ':now': now },
            },
          },
        ],
        604800, // 7-day TTL for financial operations
      );
    },
  );
```

Import `guardedWrite` from `@nestfolio/lambda-utils`.

- [ ] **Step 2: Update `processDepositInitiated` to use `guardedAddToCashBalance`**

In `services/execution/execution-adpt/src/handlers/event-listener.ts`, change `processDepositInitiated`:

```typescript
    // Guarded credit — prevents double-deposit on replay
    const processed = await deps.repository.guardedAddToCashBalance(
      tenantId, userId, currency, amount, event.id as string,
    );
    if (!processed) {
      logger.info('Deposit already processed, skipping', { depositId, eventId: event.id });
      return;
    }
```

- [ ] **Step 3: Update `processWithdrawalRequested` — same pattern**

Add `guardedWithdrawal` or reuse `guardedAddToCashBalance` with negative amount. The withdrawal uses `updateCashBalanceConditional` (optimistic locking), so wrap that in a `guardedWrite`.

Actually, per the spec, withdrawals use the same pattern as deposits — `guardedWrite` with a marker. The business operation is the conditional balance update.

- [ ] **Step 4: Update `SimulationEngineService` — deterministic trade ID**

In `services/execution/execution-adpt/src/services/simulation-engine.service.ts`:
1. Change `tradeId: getUUID()` → `tradeId: orderId` (line 76)
2. Remove `getUUID` import

- [ ] **Step 5: Update `executeTrade` in VirtualLedgerRepository — deterministic sort key**

Change `sk: \`Trade#${now}#${tradeId}\`` → `sk: \`Trade#${tradeId}\`` and add `putIfNotExists` condition to the trade record Put within the transactWrite.

In the existing `transactWrite`, add a condition to the trade record Put:

```typescript
      const tradeRecord = {
        Put: {
          TableName: this.tableName,
          Item: { /* ... same ... */ },
          ConditionExpression: 'attribute_not_exists(pk)',
        },
      };
```

On duplicate, the `transactWrite` will fail with `TransactionCanceledException`. Catch this at the `executeTrade` call site (in `processOrderSubmitted`) and treat it as a silent skip.

- [ ] **Step 6: Remove IdempotencyGuard from execution-adpt event listener**

1. Remove `IdempotencyGuard` from import + deps + `ensureOnce` check + wiring

- [ ] **Step 7: Update tests**

Remove `idempotencyGuard` mock. Add tests for:
- Duplicate deposit: `guardedAddToCashBalance` returns `false`
- Duplicate trade: `executeTrade` throws `TransactionCanceledException`, verify silent skip

- [ ] **Step 8: Run tests**

Run: `npx nx test execution-adpt --verbose`
Expected: All tests pass

- [ ] **Step 9: Commit**

```bash
git add services/execution/execution-adpt/
git commit -m "refactor(execution-adpt): guardedWrite for deposits/withdrawals, deterministic trade IDs"
```

---

### Task 13: Migrate ledger-ctrl — putIfNotExists for ledger entries, deterministic simulation event IDs

**Files:**
- Modify: `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`
- Modify: `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`
- Modify: `services/ledger/ledger-ctrl/test/handlers/event-listener.test.ts`

- [ ] **Step 1: Update `putLedgerEntry` to use `putIfNotExists` and restructure key**

In `services/ledger/ledger-ctrl/src/repositories/ledger.repository.ts`:

Change the `putLedgerEntry` method:
1. Change sort key from `Event#${sequenceNo}#${eventId}` → `Event#${eventId}`
2. Store `sequenceNo` as an attribute only (not in the key)
3. Use `putIfNotExists` and return `boolean`

```typescript
  readonly putLedgerEntry = this.log('putLedgerEntry',
    async (entry: LedgerEntryItem): Promise<boolean> => {
      const item: TableEntry = {
        pk: `Account#${entry.tenantId}#${entry.streamType}`,
        sk: `Event#${entry.eventId}`,
        __typename: 'LedgerEntry',
        tenantId: entry.tenantId,
        timestamp: entry.timestamp,
        streamType: entry.streamType,
        eventId: entry.eventId,
        eventType: entry.eventType,
        payload: entry.payload,
        sequenceNo: entry.sequenceNo,
        decisionId: entry.decisionId,
        sourceEventId: entry.eventId,
      };
      return this.putIfNotExists(item);
    },
  );
```

- [ ] **Step 2: Update `processActualEvent` — call `nextSequence` only after successful putLedgerEntry**

In `services/ledger/ledger-ctrl/src/handlers/event-listener.ts`, change `processActualEvent`:

```typescript
async function processActualEvent(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
  eventType: string,
): Promise<void> {
  const tenantId = extractTenantId(event);
  const subject = (event.subject ?? {}) as Record<string, unknown>;
  const context = (event.context ?? {}) as Record<string, unknown>;
  const payload = { ...subject, userId: subject['userId'] ?? context['userId'] };

  // Try to write the entry first (idempotency via putIfNotExists)
  const sequenceNo = await deps.repository.nextSequence(tenantId, 'actual');

  const created = await deps.repository.putLedgerEntry({
    tenantId,
    streamType: 'actual',
    eventId: event.id as string,
    eventType,
    payload,
    timestamp: event.timestamp as string,
    sequenceNo,
    decisionId: subject['decisionId'] as string | undefined,
  });

  if (!created) {
    logger.info('Ledger entry already exists, skipping', { eventId: event.id, eventType });
    // Note: sequence number was incremented but entry not written — this creates a gap.
    // Gaps are acceptable per the design spec (consumers use range queries, not continuity).
    return;
  }

  deps.metrics.addMetric('EventProcessed', MetricUnit.Count, 1);
}
```

- [ ] **Step 3: Update `processSimulationEvent` — deterministic event IDs**

Change `eventId: getUUID()` → `eventId: \`${event.id}-sim-${trade.symbol}\``:

```typescript
async function processSimulationEvent(
  deps: EventListenerDeps,
  event: Record<string, unknown>,
): Promise<void> {
  const tenantId = extractTenantId(event);
  const subject = (event.subject ?? {}) as Record<string, unknown>;
  const decisionPacketId = (subject['decisionPacketId'] as string) ?? (event.id as string);
  const proposedTrades = (subject['proposedTrades'] ?? []) as ProposedTrade[];

  if (proposedTrades.length === 0) {
    logger.info('No proposed trades in decision packet, skipping', { decisionPacketId });
    return;
  }

  for (const trade of proposedTrades) {
    const fillResult = await deps.shadowFill.simulateFill(trade);
    const eventId = `${event.id}-sim-${trade.symbol}`;

    const created = await deps.repository.putLedgerEntry({
      tenantId,
      streamType: 'simulated',
      eventId,
      eventType: 'ORDER_FILLED',
      payload: {
        orderId: `sim-${decisionPacketId}-${trade.symbol}`,
        symbol: trade.symbol,
        side: trade.side,
        quantity: trade.quantity,
        fillPrice: fillResult.price,
        filledAt: getTime(),
      },
      timestamp: getTime(),
      sequenceNo: await deps.repository.nextSequence(tenantId, 'simulated'),
      decisionId: decisionPacketId,
    });

    if (!created) {
      logger.info('Simulation entry already exists, skipping', { eventId });
      continue;
    }
  }

  deps.metrics.addMetric('SimulationProcessed', MetricUnit.Count, 1);
}
```

Remove `getUUID` import if no longer used.

- [ ] **Step 4: Remove IdempotencyGuard from ledger-ctrl event listener**

1. Remove `IdempotencyGuard` from import + deps + both `ensureOnce` checks (lines 76 and 83) + wiring

- [ ] **Step 5: Update `queryEntriesSince`**

The sort key changed from `Event#${sequenceNo}#${eventId}` to `Event#${eventId}`. The `queryEntriesSince` method uses `sk BETWEEN :skStart AND :skEnd` with padded sequence numbers. This query pattern won't work with non-numeric sort keys.

Update `queryEntriesSince` to sort by the `sequenceNo` attribute instead of the sort key:

```typescript
  // TODO: This uses FilterExpression + in-memory sort, which reads ALL events then filters client-side.
  // The old sk-range query (Event#${sequenceNo}#${eventId}) was more efficient.
  // If query volume grows, consider adding a GSI with sequenceNo as sort key.
  readonly queryEntriesSince = this.log('queryEntriesSince',
    async (
      tenantId: string,
      streamType: string,
      sinceSequence: number,
    ): Promise<Record<string, unknown>[]> => {
      const pk = `Account#${tenantId}#${streamType}`;
      const result = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          FilterExpression: 'sequenceNo > :sinceSeq',
          ExpressionAttributeValues: {
            ':pk': pk,
            ':sk': 'Event#',
            ':sinceSeq': sinceSequence,
          },
        }),
      );
      // Sort by sequenceNo since sk is no longer sequence-ordered
      const items = result.Items ?? [];
      return items.sort((a, b) => ((a as any).sequenceNo ?? 0) - ((b as any).sequenceNo ?? 0));
    },
  );
```

- [ ] **Step 6: Update tests**

Remove `idempotencyGuard` mock. Add tests for:
- Duplicate actual event: `putLedgerEntry` returns `false`
- Duplicate simulation entry per trade: `putLedgerEntry` returns `false` for specific trade
- Verify deterministic simulation eventId format

- [ ] **Step 7: Run tests**

Run: `npx nx test ledger-ctrl --verbose`
Expected: All tests pass

- [ ] **Step 8: Commit**

```bash
git add services/ledger/ledger-ctrl/
git commit -m "refactor(ledger-ctrl): putIfNotExists for ledger entries, deterministic simulation IDs"
```

---

## Chunk 5: Cleanup — Delete IdempotencyGuard

### Task 14: Delete IdempotencyGuard class, tests, and remove all remaining imports

**Files:**
- Delete: `libs/lambda-utils/src/idempotency.ts`
- Delete: `libs/lambda-utils/test/idempotency.test.ts`
- Modify: `libs/lambda-utils/src/index.ts` — remove `IdempotencyGuard` export

- [ ] **Step 1: Verify no remaining imports of IdempotencyGuard**

Run: `grep -r "IdempotencyGuard\|idempotencyGuard\|ensureOnce" --include="*.ts" services/ libs/`
Expected: No matches (all services migrated in previous tasks)

If any matches remain, migrate them first before proceeding.

- [ ] **Step 2: Remove `IdempotencyGuard` export from lambda-utils index**

In `libs/lambda-utils/src/index.ts`, delete line 20:
```typescript
export { IdempotencyGuard } from './idempotency';
```

- [ ] **Step 3: Delete IdempotencyGuard source file**

```bash
rm libs/lambda-utils/src/idempotency.ts
```

- [ ] **Step 4: Delete IdempotencyGuard test file**

```bash
rm libs/lambda-utils/test/idempotency.test.ts
```

- [ ] **Step 5: Run all lambda-utils tests**

Run: `npx nx test lambda-utils --verbose`
Expected: All tests pass (idempotency tests removed, guarded-write tests remain)

- [ ] **Step 6: Run full test suite across all affected projects**

Run: `npx nx run-many -t test --projects=platform-core,lambda-utils,investor-bff,advisory-bff,dashboard-bff,ledger-bff,advisory-ctrl,compliance-ctrl,execution-ctrl,investor-ctrl,reconciliation-ctrl,execution-adpt,ledger-ctrl --verbose`
Expected: All 13 projects pass

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(lambda-utils): delete IdempotencyGuard class and tests"
```

---

## Summary

| Chunk | Tasks | Risk | Services |
|-------|-------|------|----------|
| 1: Shared Libs | 1-2 | None (additive) | platform-core, lambda-utils |
| 2: BFF Services | 3-6 | Low | investor-bff, advisory-bff, dashboard-bff, ledger-bff |
| 3: Controllers | 7-11 | Medium | advisory-ctrl, compliance-ctrl, execution-ctrl, investor-ctrl, reconciliation-ctrl |
| 4: High-Risk | 12-13 | High | execution-adpt, ledger-ctrl |
| 5: Cleanup | 14 | None | lambda-utils |

**Total: 14 tasks, 5 chunks, ~80 test changes across 13 projects**
