import {
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
} from '@nestfolio/integration-testing';

describe('broker-ctrl', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();

    // Trap captures the funding lifecycle events emitted from FundingEvent DDB
    // carrier rows via CDC (`field:'sk', passthrough` re-emits sk as the event).
    await trap.deploy({
      bus: 'execution',
      detailType: [
        'DEPOSIT_DETECTED',
        'DEPOSIT_SETTLED',
        'WITHDRAWAL_SETTLED',
        'DEPOSIT_FAILED',
        'WITHDRAWAL_FAILED',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Mode Listener ────────────────────────────────────────────────────

  it('should write ExecutionMode record on EXECUTION_MODE_CHANGED', async () => {
    await eb.putEvent({
      bus: 'execution',
      targetService: 'broker-ctrl',
      detailType: 'EXECUTION_MODE_CHANGED',
      detail: { mode: 'live' },
    });

    const item = await table.waitForItem({
      table: 'broker-ctrl',
      pk: `ExecutionMode#${ctx.tenantId}`,
      sk: 'ExecutionMode',
      timeoutMs: 60_000,
    });

    expect(item['__typename']).toBe('ExecutionMode');
    expect(item['tenantId']).toBe(ctx.tenantId);
    expect(item['mode']).toBe('live');
  }, 120_000);

  // ── Deposit/Withdrawal Normalizer ────────────────────────────────────
  // The normalizer writes one immutable FundingEvent carrier row per lifecycle
  // transition (pk = Funding#<tenantId>#<transferId>, sk = the lifecycle event
  // name). CDC re-emits sk as the bus event carrying the full snapshot.

  describe('deposit-withdrawal-normalizer', () => {
    it('should write [DEPOSIT_DETECTED v2, DEPOSIT_SETTLED v3] FundingEvent carriers and emit both via CDC on SIM_DEPOSIT_COMPLETED', async () => {
      const depositId = `integ-deposit-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_DEPOSIT_COMPLETED',
        detail: {
          depositId,
          amountCents: 100000,
          currency: 'USD',
        },
      });

      // Assert: DEPOSIT_DETECTED carrier (v2)
      const detected = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_DETECTED',
        timeoutMs: 60_000,
      });

      expect(detected['__typename']).toBe('FundingEvent');
      expect(detected['tenantId']).toBe(ctx.tenantId);
      expect(detected['amountCents']).toBe(100000);
      expect(detected['currency']).toBe('USD');
      expect(detected['executionMode']).toBe('simulation');
      expect(detected['direction']).toBe('DEPOSIT');
      expect(detected['status']).toBe('detected');
      expect(detected['__version']).toBe(2);
      expect(detected['detectedAt']).toBeDefined();

      // Assert: DEPOSIT_SETTLED carrier (v3, settledAt present)
      const settled = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_SETTLED',
        timeoutMs: 60_000,
      });

      expect(settled['__typename']).toBe('FundingEvent');
      expect(settled['status']).toBe('settled');
      expect(settled['__version']).toBe(3);
      expect(settled['settledAt']).toBeDefined();
      expect(settled['amountCents']).toBe(100000);

      // Assert: CDC emits both DEPOSIT_DETECTED and DEPOSIT_SETTLED on EventBridge
      const detectedCdc = await trap.waitForEvent({
        detailType: 'DEPOSIT_DETECTED',
        timeoutMs: 30_000,
      });
      const detectedCtx = detectedCdc.detail['context'] as Record<string, unknown>;
      expect(detectedCtx['tenantId']).toBe(ctx.tenantId);
      const detectedSubject = detectedCdc.detail['subject'] as Record<string, unknown>;
      expect(detectedSubject['amountCents']).toBe(100000);

      const settledCdc = await trap.waitForEvent({
        detailType: 'DEPOSIT_SETTLED',
        timeoutMs: 30_000,
      });
      const settledSubject = settledCdc.detail['subject'] as Record<string, unknown>;
      expect(settledSubject['settledAt']).toBeDefined();
      expect(settledSubject['amountCents']).toBe(100000);
    }, 120_000);

    it('should write [WITHDRAWAL_SETTLED v3] FundingEvent carrier and emit WITHDRAWAL_SETTLED via CDC on SIM_WITHDRAWAL_COMPLETED', async () => {
      const withdrawalId = `integ-withdrawal-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'SIM_WITHDRAWAL_COMPLETED',
        detail: {
          withdrawalId,
          amountCents: 50000,
          currency: 'EUR',
        },
      });

      // Assert: WITHDRAWAL_SETTLED carrier (v3, settledAt present)
      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${withdrawalId}`,
        sk: 'WITHDRAWAL_SETTLED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['amountCents']).toBe(50000);
      expect(item['currency']).toBe('EUR');
      expect(item['executionMode']).toBe('simulation');
      expect(item['direction']).toBe('WITHDRAWAL');
      expect(item['status']).toBe('settled');
      expect(item['__version']).toBe(3);
      expect(item['settledAt']).toBeDefined();

      // Assert: CDC emits WITHDRAWAL_SETTLED on EventBridge
      const cdcEvent = await trap.waitForEvent({
        detailType: 'WITHDRAWAL_SETTLED',
        timeoutMs: 30_000,
      });
      const context = cdcEvent.detail['context'] as Record<string, unknown>;
      expect(context['tenantId']).toBe(ctx.tenantId);
      const subject = cdcEvent.detail['subject'] as Record<string, unknown>;
      expect(subject['amountCents']).toBe(50000);
      expect(subject['settledAt']).toBeDefined();
    }, 120_000);

    it('should write [DEPOSIT_FAILED v3] FundingEvent carrier and emit DEPOSIT_FAILED via CDC on ALPACA_TRANSFER_FAILED INCOMING', async () => {
      const transferId = `integ-transfer-fail-${Date.now()}`;

      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'ALPACA_TRANSFER_FAILED',
        detail: {
          transferId,
          amountCents: 25000,
          direction: 'INCOMING',
          failureReason: 'Insufficient funds in bank account',
        },
      });

      // Assert: DEPOSIT_FAILED carrier (v3, reason + failedAt). No requested
      // carrier exists for this isolated EB-injected event, so carry-forward
      // falls back to the injected subject fields.
      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${transferId}`,
        sk: 'DEPOSIT_FAILED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['amountCents']).toBe(25000);
      expect(item['executionMode']).toBe('live');
      expect(item['direction']).toBe('DEPOSIT');
      expect(item['status']).toBe('failed');
      expect(item['__version']).toBe(3);
      expect(item['reason']).toBe('Insufficient funds in bank account');
      expect(item['failedAt']).toBeDefined();

      // Assert: CDC emits DEPOSIT_FAILED on EventBridge
      const cdcEvent = await trap.waitForEvent({
        detailType: 'DEPOSIT_FAILED',
        timeoutMs: 30_000,
      });
      const context = cdcEvent.detail['context'] as Record<string, unknown>;
      expect(context['tenantId']).toBe(ctx.tenantId);
      const subject = cdcEvent.detail['subject'] as Record<string, unknown>;
      expect(subject['reason']).toBe('Insufficient funds in bank account');
    }, 120_000);
  });

  // ── Deposit/Withdrawal Router ────────────────────────────────────────
  // The router emits a routed event (SIM_*/ALPACA_*) to the adapter via a raw
  // EventBridge PutEvents call, AND materializes a requested FundingEvent
  // carrier (v1) to its own table. The routed emission targets an adapter not
  // present in an isolated test, so we assert on the requested carrier row.

  describe('deposit-withdrawal-router', () => {
    it('should write a requested DEPOSIT_REQUESTED FundingEvent carrier on DEPOSIT_INITIATED', async () => {
      // Relies on ExecutionMode record written by mode-listener test above
      await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 30_000,
      });

      const depositId = `integ-route-dep-${Date.now()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'DEPOSIT_INITIATED',
        detail: {
          depositId,
          amountCents: 75000,
          currency: 'USD',
        },
      });

      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${depositId}`,
        sk: 'DEPOSIT_REQUESTED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['direction']).toBe('DEPOSIT');
      expect(item['status']).toBe('requested');
      expect(item['__version']).toBe(1);
      expect(item['amountCents']).toBe(75000);
      expect(item['currency']).toBe('USD');
    }, 120_000);

    it('should write a requested WITHDRAWAL_REQUESTED FundingEvent carrier on WITHDRAWAL_INITIATED', async () => {
      // Relies on ExecutionMode record written by mode-listener test above
      await table.waitForItem({
        table: 'broker-ctrl',
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
        timeoutMs: 30_000,
      });

      const withdrawalId = `integ-route-wd-${Date.now()}`;
      await eb.putEvent({
        bus: 'execution',
        targetService: 'broker-ctrl',
        detailType: 'WITHDRAWAL_INITIATED',
        detail: {
          withdrawalId,
          amountCents: 30000,
          currency: 'USD',
        },
      });

      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${withdrawalId}`,
        sk: 'WITHDRAWAL_REQUESTED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['direction']).toBe('WITHDRAWAL');
      expect(item['status']).toBe('requested');
      expect(item['__version']).toBe(1);
      expect(item['amountCents']).toBe(30000);
      expect(item['currency']).toBe('USD');
    }, 120_000);
  });
});
