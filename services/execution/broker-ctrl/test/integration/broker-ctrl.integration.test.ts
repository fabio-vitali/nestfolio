import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
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
      detailType: 'EXECUTION_MODE_CHANGED' as const,
      // ExecutionModeChangedSchema: {changeId, fromMode, toMode, changedAt}.
      // The mode-listener caches mode = toMode, so toMode:'live' → cached mode:'live'.
      subject: {
        changeId: randomUUID(),
        fromMode: 'simulation' as const,
        toMode: 'live' as const,
        changedAt: new Date().toISOString(),
      },
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
        subject: {
          depositId,
          amountCents: 100000,
          currency: 'USD',
          sourceEventId: 'evt-sim-dep',
          timestamp: new Date().toISOString(),
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
        subject: {
          // SimWithdrawalCompletedSchema carries `amount` (DOLLARS), NOT amountCents/currency.
          withdrawalId,
          amount: 500, // dollars → carrier amountCents = Math.round(500*100) = 50000
          sourceEventId: 'evt-sim-wd',
          timestamp: new Date().toISOString(),
        },
      });

      // Assert: WITHDRAWAL_SETTLED carrier (v3, settledAt present).
      // No requested carrier is pre-seeded in this block, so carryForward MISSES and
      // falls back: amountCents = Math.round(amount*100) = 50000, currency = 'USD'.
      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${withdrawalId}`,
        sk: 'WITHDRAWAL_SETTLED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['amountCents']).toBe(50000); // Math.round(500*100), fallback (MISS)
      expect(item['currency']).toBe('USD'); // fallback default (schema carries no currency)
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
          // AlpacaTransferResultSchema shape: nestfolioTransferId (NOT transferId),
          // alpacaTransferId, direction, amount (DOLLARS), status; failureReason optional.
          nestfolioTransferId: transferId,
          alpacaTransferId: 'alpaca-fail-xfr',
          direction: 'INCOMING',
          amount: 250, // dollars → carrier amountCents = Math.round(250*100) = 25000 (fallback)
          status: 'FAILED',
          failureReason: 'Insufficient funds in bank account',
        },
      });

      // Assert: DEPOSIT_FAILED carrier (v3, reason + failedAt). No requested
      // carrier exists for this isolated EB-injected event, so carry-forward
      // MISSES and falls back: amountCents = Math.round(amount*100) = 25000,
      // reason = failureReason. executionMode is hardcoded 'live' by the handler.
      const item = await table.waitForItem({
        table: 'broker-ctrl',
        pk: `Funding#${ctx.tenantId}#${transferId}`,
        sk: 'DEPOSIT_FAILED',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('FundingEvent');
      expect(item['tenantId']).toBe(ctx.tenantId);
      expect(item['amountCents']).toBe(25000); // Math.round(250*100), fallback (MISS)
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
        detailType: 'DEPOSIT_INITIATED' as const,
        subject: {
          depositId,
          amountCents: 75000,
          currency: 'USD',
          timestamp: new Date().toISOString(),
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
        detailType: 'WITHDRAWAL_INITIATED' as const,
        subject: {
          withdrawalId,
          amountCents: 30000,
          currency: 'USD',
          timestamp: new Date().toISOString(),
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

  // ── Funding Normalizer — carryForward regression ─────────────────────────
  // Task 7, Step 2: prove that carryForward HITS the pre-seeded DEPOSIT_REQUESTED
  // carrier and threads amountCents end-to-end in both the sim and live paths.
  //
  // We pre-seed the DEPOSIT_REQUESTED carrier directly via DDB PutCommand (same
  // technique as the CB describe block in broker-alpaca-adpt) to avoid coupling
  // the router's ExecutionMode lookup — which is already tested above.

  describe('funding-normalizer carryForward', () => {
    let ddb: DynamoDBDocumentClient;
    let ctrlTableName: string;

    beforeAll(async () => {
      ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: ctx.region }));
      ctrlTableName = await ctx.ssm.tableName('broker-ctrl');
    });

    // Seeds a DEPOSIT_REQUESTED carrier with a DISTINCTIVE initiatedAt/userId so a
    // carryForward HIT is provable: only a row read can yield the seeded initiatedAt
    // (the fallback uses ctx.timestamp = "now", never 2020-01-01).
    const SEEDED_INITIATED_AT = '2020-01-01T00:00:00.000Z';
    const SEEDED_USER_ID = 'u-seeded';

    async function seedDepositRequested(
      transferId: string,
      amountCents: number,
      executionMode: 'simulation' | 'live',
    ): Promise<void> {
      await ddb.send(
        new PutCommand({
          TableName: ctrlTableName,
          Item: {
            pk: `Funding#${ctx.tenantId}#${transferId}`,
            sk: 'DEPOSIT_REQUESTED',
            __typename: 'FundingEvent',
            direction: 'DEPOSIT',
            status: 'requested',
            transferId,
            tenantId: ctx.tenantId,
            userId: SEEDED_USER_ID,
            region: ctx.region,
            amountCents,
            currency: 'USD',
            executionMode,
            initiatedAt: SEEDED_INITIATED_AT,
            timestamp: SEEDED_INITIATED_AT,
            __version: 1,
          },
        }),
      );
    }

    async function deleteCarrierRows(transferId: string, skList: string[]): Promise<void> {
      for (const sk of skList) {
        try {
          await ddb.send(
            new DeleteCommand({
              TableName: ctrlTableName,
              Key: { pk: `Funding#${ctx.tenantId}#${transferId}`, sk },
            }),
          );
        } catch { /* row may not exist — ignore */ }
      }
    }

    it('should carry amountCents forward from DEPOSIT_REQUESTED into DEPOSIT_SETTLED on SIM_DEPOSIT_COMPLETED (proves HIT not fallback)', async () => {
      // Task 7 Step 2 (sim path): proves carryForward HITS the pre-seeded row.
      // Seeded amountCents=7000; completion sends amountCents=6900 → the fallback
      // (s.amountCents) would yield 6900. Asserting 7000 can ONLY be satisfied by a
      // row read. Asserting the seeded initiatedAt (2020-01-01, vs fallback ctx.timestamp)
      // is the belt-and-suspenders proof that the requested row was the source.
      const depositId = `dep-int-2-${Date.now()}`;
      await seedDepositRequested(depositId, 7000, 'simulation');

      try {
        await eb.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'SIM_DEPOSIT_COMPLETED',
          subject: {
            depositId,
            amountCents: 6900, // ≠ seeded 7000 → fallback would yield 6900
            currency: 'USD',
            sourceEventId: 'x',
            timestamp: 't',
          },
        });

        // Assert DEPOSIT_SETTLED carrier: amountCents=7000 (HIT, not the 6900 fallback)
        // + initiatedAt=seeded value (only the requested row supplies this).
        const settled = await table.waitForItem({
          table: 'broker-ctrl',
          pk: `Funding#${ctx.tenantId}#${depositId}`,
          sk: 'DEPOSIT_SETTLED',
          timeoutMs: 60_000,
        });

        expect(settled['__typename']).toBe('FundingEvent');
        expect(settled['amountCents']).toBe(7000); // HIT — fallback would be 6900
        expect(settled['initiatedAt']).toBe(SEEDED_INITIATED_AT); // HIT — fallback = ctx.timestamp
        // NB: carrier userId is ctx-stamped (DRY identity), not carried forward — HIT is proven by amountCents + initiatedAt above
        expect(settled['status']).toBe('settled');
        expect(settled['__version']).toBe(3);
        expect(settled['settledAt']).toBeDefined();
        expect(settled['executionMode']).toBe('simulation');
        expect(settled['direction']).toBe('DEPOSIT');

        // CDC event confirms carried-forward amountCents flows through.
        // Filter the wait on this case's unique transferId (the DEPOSIT_SETTLED subject
        // is a FundingSnapshot carrying transferId) so the shared trap cannot hand us
        // the OTHER carryForward case's DEPOSIT_SETTLED event — both assert the same
        // amountCents/initiatedAt, so a cross-case mix-up would be a false positive.
        const cdcEvent = await trap.waitForEvent<{ subject: { transferId: string } }>({
          detailType: 'DEPOSIT_SETTLED',
          match: (d) => d.subject?.transferId === depositId,
          timeoutMs: 30_000,
        });
        const subject = cdcEvent.detail['subject'] as Record<string, unknown>;
        expect(subject['transferId']).toBe(depositId); // this case's event, not the other's
        expect(subject['amountCents']).toBe(7000);
        expect(subject['initiatedAt']).toBe(SEEDED_INITIATED_AT);
        expect(subject['settledAt']).toBeDefined();
      } finally {
        await deleteCarrierRows(depositId, ['DEPOSIT_REQUESTED', 'DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
      }
    }, 120_000);

    it('should carry amountCents forward from DEPOSIT_REQUESTED into DEPOSIT_SETTLED on ALPACA_TRANSFER_COMPLETED (live path — core carryForward regression, proves HIT not fallback)', async () => {
      // Task 7 Step 2 (alpaca/live path): the CORE regression gate. The completion's
      // amount is 69 dollars → the fallback yields Math.round(69*100)=6900. The seeded
      // DEPOSIT_REQUESTED row carries amountCents=7000. Asserting 7000 can ONLY pass on
      // a carryForward HIT (a miss yields 6900). The seeded initiatedAt (2020-01-01)
      // is the belt-and-suspenders proof: only the requested row supplies it; the
      // fallback uses ctx.timestamp. (executionMode='live' alone is NOT a HIT proof —
      // the alpaca handler hardcodes 'live' regardless of the read.)
      const depositId = `dep-int-3-${Date.now()}`;
      await seedDepositRequested(depositId, 7000, 'live');

      try {
        await eb.putEvent({
          bus: 'execution',
          targetService: 'broker-ctrl',
          detailType: 'ALPACA_TRANSFER_COMPLETED',
          detail: {
            nestfolioTransferId: depositId,
            alpacaTransferId: 'a',
            amount: 69, // dollars → fallback would be Math.round(69*100)=6900, NOT 7000
            direction: 'INCOMING',
            status: 'COMPLETED',
          },
        });

        // Assert DEPOSIT_SETTLED carrier — the two HIT-proving assertions:
        //   amountCents=7000  (seeded; fallback would be 6900)
        //   initiatedAt=seeded (only the requested row supplies it; fallback=ctx.timestamp)
        const settled = await table.waitForItem({
          table: 'broker-ctrl',
          pk: `Funding#${ctx.tenantId}#${depositId}`,
          sk: 'DEPOSIT_SETTLED',
          timeoutMs: 60_000,
        });

        expect(settled['__typename']).toBe('FundingEvent');
        expect(settled['amountCents']).toBe(7000); // HIT — fallback would be 6900
        expect(settled['initiatedAt']).toBe(SEEDED_INITIATED_AT); // HIT — fallback = ctx.timestamp
        // NB: carrier userId is ctx-stamped (DRY identity), not carried forward — HIT is proven by amountCents + initiatedAt above
        expect(settled['executionMode']).toBe('live');
        expect(settled['status']).toBe('settled');
        expect(settled['__version']).toBe(3);
        expect(settled['settledAt']).toBeDefined();
        expect(settled['direction']).toBe('DEPOSIT');

        // CDC event confirms carried-forward amountCents flows through the live path.
        // Filter the wait on this case's unique transferId (the DEPOSIT_SETTLED subject
        // is a FundingSnapshot carrying transferId) so the shared trap cannot hand us
        // the OTHER carryForward case's DEPOSIT_SETTLED event — both assert the same
        // amountCents/initiatedAt, so a cross-case mix-up would be a false positive.
        const cdcEvent = await trap.waitForEvent<{ subject: { transferId: string } }>({
          detailType: 'DEPOSIT_SETTLED',
          match: (d) => d.subject?.transferId === depositId,
          timeoutMs: 30_000,
        });
        const subject = cdcEvent.detail['subject'] as Record<string, unknown>;
        expect(subject['transferId']).toBe(depositId); // this case's event, not the other's
        expect(subject['amountCents']).toBe(7000);
        expect(subject['initiatedAt']).toBe(SEEDED_INITIATED_AT);
      } finally {
        await deleteCarrierRows(depositId, ['DEPOSIT_REQUESTED', 'DEPOSIT_DETECTED', 'DEPOSIT_SETTLED']);
      }
    }, 120_000);
  });
});
