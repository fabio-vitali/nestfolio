import { randomUUID } from 'node:crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import {
  EventBridgeClient,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  MockApiFixture,
  SsmOverrideFixture,
  countItems,
} from '@nestfolio/integration-testing';

// ── Helpers ──────────────────────────────────────────────────────────────
//
// broker-alpaca-adpt stores entities under:
//   AlpacaOrderResult     → pk: `OrderMapping#${tenantId}#${orderId}`       sk: 'OrderMapping'
//   AlpacaTransferResult  → pk: `TransferMapping#${tenantId}#${transferId}` sk: 'TransferMapping'
//
// Idempotency: the event-processor pipeline dedups by ctx.eventId, so a
// duplicate publish with the same eventId should not trigger a second
// record() write. However, the Alpaca API *mock* may still be invoked
// twice (the HTTP call to the Lambda Function URL happens before the
// dedup write is committed — or in parallel, depending on pipeline
// ordering). What we verify here is the DDB-level invariant: exactly ONE
// row per OrderMapping / TransferMapping PK regardless of duplicate
// publishes.
//
// Mock + SSM override are deployed once per file in beforeAll because
// they are stateless infrastructure shared by both tests. Each it()
// creates its own TestContext to keep tenant data isolated.

describe('broker-alpaca-adpt resilience: idempotency', () => {
  let mockCtx: Awaited<ReturnType<typeof createIntegrationTestContext>>;
  let mockApi: MockApiFixture;
  let ssmOverride: SsmOverrideFixture;

  beforeAll(async () => {
    mockCtx = await createIntegrationTestContext();

    mockApi = new MockApiFixture(mockCtx);
    const zipPath = join(__dirname, '..', 'mocks', 'mock-alpaca.zip');
    const mockUrl = await mockApi.deploy({
      name: 'mock-alpaca',
      handlerAsset: readFileSync(zipPath),
    });

    ssmOverride = new SsmOverrideFixture(mockCtx);
    await ssmOverride.override({
      paramName: `/nestfolio/${mockCtx.prefix}-broker-alpaca-adpt/alpaca/baseUrl`,
      testValue: mockUrl,
      restoreTo: 'https://paper-api.alpaca.markets',
    });

    // Clean up any stale CircuitBreaker record left by a previous run
    const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: mockCtx.region }));
    const cbTableName = await mockCtx.ssm.tableName('broker-alpaca-adpt');
    try {
      await ddb.send(new DeleteCommand({
        TableName: cbTableName,
        Key: { pk: 'CircuitBreaker#alpaca', sk: 'CircuitBreaker' },
      }));
    } catch { /* item may not exist */ }
  }, 120_000);

  afterAll(async () => {
    await mockCtx.cleanup.runAll();
  }, 60_000);

  it('duplicate ALPACA_ORDER_REQUESTED does not create duplicate AlpacaOrderResult record', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'execution',
        detailType: ['ALPACA_ORDER_PLACED', 'ALPACA_ORDER_REJECTED'],
      });

      const eventId = `idemp-alp-order-${randomUUID()}`;
      const orderId = `idemp-alp-order-${randomUUID()}`;
      const payload = { orderId, symbol: 'AAPL', side: 'BUY' as const, quantity: 5 };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        subject: payload,
        eventId,
      });

      // Wait for the OrderMapping row to land
      const firstItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `OrderMapping#${ctx.tenantId}#${orderId}`,
        sk: 'OrderMapping',
        timeoutMs: 90_000,
      });
      expect(firstItem['__typename']).toBe('AlpacaOrderResult');
      expect(firstItem['nestfolioOrderId']).toBe(orderId);
      expect(firstItem['status']).toBe('PLACED');

      // Wait for the first ALPACA_ORDER_PLACED CDC event and drain residuals
      await trap.waitForEvent({
        detailType: 'ALPACA_ORDER_PLACED',
        timeoutMs: 60_000,
      });
      await trap.drain();

      // Duplicate publish (same eventId + payload). The Alpaca mock may
      // receive this second HTTP call, but the event-processor dedup on
      // ctx.eventId must prevent a second DDB record() write.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_ORDER_REQUESTED',
        subject: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      // Assert: still exactly one AlpacaOrderResult row for this order
      const count = await countItems(
        table,
        'broker-alpaca-adpt',
        `OrderMapping#${ctx.tenantId}#${orderId}`,
      );
      expect(count).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 240_000);

  it('duplicate ALPACA_TRANSFER_REQUESTED does not create duplicate AlpacaTransferResult record', async () => {
    const ctx = await createIntegrationTestContext();
    try {
      const eb = new EventBridgeClient(ctx);
      const table = new TableAssertions(ctx);
      table.registerCleanup();
      const trap = new EventBusTrap(ctx);
      await trap.deploy({
        bus: 'execution',
        detailType: ['ALPACA_TRANSFER_INITIATED', 'ALPACA_TRANSFER_FAILED'],
      });

      const eventId = `idemp-alp-transfer-${randomUUID()}`;
      const transferId = `idemp-alp-transfer-${randomUUID()}`;
      const payload = {
        // AlpacaTransferRequestSchema: amountCents (NOT amount) + currency.
        transferId,
        amountCents: 1_000_000, // $10,000
        currency: 'USD',
        direction: 'INCOMING' as const,
        relationshipId: 'rel-integ',
      };

      // First publish
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_TRANSFER_REQUESTED',
        subject: payload,
        eventId,
      });

      // Wait for the TransferMapping row to land
      const firstItem = await table.waitForItem({
        table: 'broker-alpaca-adpt',
        pk: `TransferMapping#${ctx.tenantId}#${transferId}`,
        sk: 'TransferMapping',
        timeoutMs: 90_000,
      });
      expect(firstItem['__typename']).toBe('AlpacaTransferResult');
      expect(firstItem['nestfolioTransferId']).toBe(transferId);
      expect(firstItem['status']).toBe('INITIATED');

      // Wait for the first ALPACA_TRANSFER_INITIATED CDC event and drain residuals
      await trap.waitForEvent({
        detailType: 'ALPACA_TRANSFER_INITIATED',
        timeoutMs: 60_000,
      });
      await trap.drain();

      // Duplicate publish (same eventId + payload). The Alpaca mock may
      // receive this second HTTP call, but the event-processor dedup on
      // ctx.eventId must prevent a second DDB record() write.
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-alpaca-adpt',
        detailType: 'ALPACA_TRANSFER_REQUESTED',
        subject: payload,
        eventId,
      });

      // Allow duplicate to be processed (or deduplicated)
      await new Promise((r) => setTimeout(r, 15_000));

      // Assert: still exactly one AlpacaTransferResult row for this transfer
      const count = await countItems(
        table,
        'broker-alpaca-adpt',
        `TransferMapping#${ctx.tenantId}#${transferId}`,
      );
      expect(count).toBe(1);
    } finally {
      await ctx.cleanup.runAll();
    }
  }, 240_000);
});
