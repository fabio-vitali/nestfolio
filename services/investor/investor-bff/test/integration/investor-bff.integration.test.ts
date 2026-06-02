import {
  CognitoFixture,
  AppSyncClient,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  createIntegrationTestContext,
  EventBusTrap,
  TableAssertions,
  StateResetFixture,
  type BusEventPayload,
} from '@nestfolio/integration-testing';

describe('investor-bff', () => {
  let ctx: TestContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;

  let appsync: AppSyncClient;
  let cognitoSub: string;

  /**
   * Helper — fetch all rows under InvestorProfile#${tenantId}#${userId}.
   * Equivalent to the spec's `getInvestorProfileItems(tenantId, userId)`.
   * The composite design has at most: 1× InvestorProfile + 1× Mandate +
   * N× Deposit#/Withdrawal#/Notification#/ExecutionModeChange#/CashBalance.
   */
  async function getInvestorProfileItems(
    tenantId: string,
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    return table.queryItems({
      table: 'investor-bff',
      pk: `InvestorProfile#${tenantId}#${userId}`,
    });
  }

  beforeAll(async () => {
    ctx = await createIntegrationTestContext();
    // Clear stale feature flag state from interrupted runs
    const stateReset = new StateResetFixture(ctx);
    await stateReset.reset([
      { table: 'investor-bff', pk: 'FeatureFlag#SYSTEM' },
    ]);

    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'investor-bff');

    // Extract Cognito sub — used as userId in AppSync resolvers via stash
    const payload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString());
    cognitoSub = payload.sub;

    // Deploy trap for all CDC event types emitted by investor-bff mutations
    // (post-resplit — composite row → INVESTOR_PROFILE_CREATED/UPDATED +
    //  Mandate row → MANDATE_ISSUED/MANDATE_REVOKED).
    await trap.deploy({
      bus: 'investor',
      detailType: [
        'DEPOSIT_INITIATED',
        'WITHDRAWAL_INITIATED',
        'INVESTOR_PROFILE_CREATED',
        'INVESTOR_PROFILE_UPDATED',
        'MANDATE_ISSUED',
        'MANDATE_REVOKED',
        'NOTIFICATION_READ',
      ],
    });
  }, 90_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 60_000);

  // ── Event Materializations ──────────────────────────────────────────

  describe('event materializations', () => {
    it('should NOT materialize InvestorProfile on USER_REGISTERED (onboarding is sole creator)', async () => {
      const userId = `integ-user-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'USER_REGISTERED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          email: `${userId}@integ-test.example`,
        },
      });

      // user-registered transform returns skip() — pre-creating a sparse row
      // would race with onboarding-completed's atomic Put and surface as
      // INVESTOR_PROFILE_UPDATED (MODIFY) instead of INVESTOR_PROFILE_CREATED
      // (INSERT) in CDC. Onboarding is the sole creator of the composite row.
      // Wait long enough that, if a row WERE being written, it would have
      // appeared by now.
      await new Promise((r) => setTimeout(r, 15_000));
      await expect(
        table.waitForItem({
          table: 'investor-bff',
          pk: `InvestorProfile#${ctx.tenantId}#${userId}`,
          sk: 'InvestorProfile',
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow();
    }, 60_000);

    it('should materialize CashBalance on BALANCE_UPDATED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          cashBalanceCents: 500_000,
          snapshot: { positions: {}, cashBalanceCents: 500_000, lastEventSequence: 7 },
        },
      });

      // projectVersioned('CashBalance', ...) keyed on snapshot.lastEventSequence as
      // __version → pk: InvestorProfile#<tenantId>#<userId>, sk: CashBalance
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'CashBalance',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('CashBalance');
      expect(item['cashBalanceCents']).toBe(500_000);
      expect(item['__version']).toBe(7);
    }, 120_000);

    it('should materialize Notification on NOTIFICATION_CREATED', async () => {
      const userId = cognitoSub;
      const notificationId = `integ-notif-${Date.now()}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'NOTIFICATION_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          notificationId,
          channel: 'IN_APP',
          title: 'Integration test notification',
          body: 'Test body',
          relatedEntityType: 'Goal',
          relatedEntityId: 'goal-123',
        },
      });

      // record('Notification', ...) with overrides → pk: InvestorProfile#<tenantId>#<userId>, sk: Notification#<notificationId>
      const notifItem = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${userId}`,
        sk: `Notification#${notificationId}`,
        timeoutMs: 60_000,
      });

      expect(notifItem).toBeDefined();
      expect(notifItem!['__typename']).toBe('Notification');
      expect(notifItem!['channel']).toBe('IN_APP');
      expect(notifItem!['title']).toBe('Integration test notification');
    }, 120_000);

    it('should atomically write composite InvestorProfile + Mandate row on ONBOARDING_COMPLETED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      // Clear any rows under this pk so jest.retryTimes(1) finds a clean slate.
      // Without this, a retry triggered by a downstream throw (e.g. the inner
      // waitForEvent timing out) would re-fire ONBOARDING_COMPLETED against the
      // row that the first attempt already wrote — turning the second Put into
      // a CDC MODIFY and emitting INVESTOR_PROFILE_UPDATED instead of CREATED.
      // Downstream tests in this suite that read by cognitoSub are unaffected;
      // they observe the row this test re-creates.
      await new StateResetFixture(ctx).reset([{ table: 'investor-bff', pk }]);

      // Mirror production flow: USER_REGISTERED then ONBOARDING_COMPLETED.
      // user-registered returns skip(), so onboarding-completed's transactWrite
      // is the first writer of the composite row — its Put surfaces as a CDC
      // INSERT and emits INVESTOR_PROFILE_CREATED.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'USER_REGISTERED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          email: `${userId}@integ-onboarding.example`,
        },
      });

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'ONBOARDING_COMPLETED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          email: `${userId}@integ-onboarding.example`,
          goal: { objective: 'GROWTH' },
          horizonYears: 10,
          accountMode: 'simulation',
          capitalAmount: 100_000,
          currency: 'USD',
          riskTolerance: 7,
          riskExperience: 5,
          operatingMode: 'BALANCED',
          mandateAccepted: true,
        },
      });

      // Wait for the composite InvestorProfile row's `mandateId` field to appear
      // (set in the transactWrite Put — its presence signals the composite row is
      // hydrated). Single long poll — jest's auto-retry would otherwise re-fire
      // ONBOARDING_COMPLETED, turning the second Put into a CDC MODIFY
      // (INVESTOR_PROFILE_UPDATED) instead of INSERT (INVESTOR_PROFILE_CREATED)
      // and breaking the event assertion below.
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        predicate: (i) => !!i['mandateId'],
        description: 'InvestorProfile row with mandateId',
        timeoutMs: 90_000,
      });

      // Composite assertions — TWO rows: InvestorProfile + Mandate
      const items = await getInvestorProfileItems(ctx.tenantId, userId);
      const profile = items.find((i) => i['sk'] === 'InvestorProfile')!;
      const mandateRow = items.find((i) => i['sk'] === 'Mandate')!;

      expect(profile).toBeDefined();
      expect(profile['__typename']).toBe('InvestorProfile');
      expect(profile['operatingMode']).toBe('BALANCED');
      expect(profile['onboardingCompletedAt']).toBeDefined();
      // Seed stamps __version: 1 so INVESTOR_PROFILE_CREATED carries a version
      // for dashboard-bff's InvestorSnapshot P1 projection (w4).
      expect(profile['__version']).toBe(1);
      // Post-resplit: InvestorProfile row mirrors mandateId + mandateLevel;
      // no nested mandate.{guardrail fields} — those live in the Mandate row.
      expect(profile['mandateId']).toBeDefined();
      expect(profile['mandateLevel']).toBeDefined();

      expect(profile['goal']).toMatchObject({
        objective: 'GROWTH',
        timeHorizonMonths: expect.any(Number),
      });
      expect(profile['riskProfile']).toMatchObject({
        score: expect.any(Number),
        band: expect.any(Object),
      });
      expect(profile['accountMode']).toMatchObject({
        mode: 'simulation',
        capitalAmount: 100_000,
        currency: 'USD',
      });

      // Mandate row (sk='Mandate') — lifecycle fields. Guardrail params
      // are resolved at evaluation time from operatingMode by compliance-ctrl.
      expect(mandateRow).toBeDefined();
      expect(mandateRow['__typename']).toBe('Mandate');
      expect(mandateRow['mandateId']).toBe(profile['mandateId']);
      expect(mandateRow['level']).toBeDefined();
      expect(mandateRow['status']).toBe('ACTIVE');
      expect(mandateRow['operatingMode']).toBe('BALANCED');
      expect(mandateRow['effectiveDate']).toBeDefined();

      // DepositIntent outbox row (capitalAmount > 0). Onboarding seeds the
      // intent; CDC emits DEPOSIT_INITIATED and broker-ctrl's lifecycle events
      // later materialize the projected Deposit row (single-writer).
      const depositIntent = items.find((i) => String(i['sk']).startsWith('DepositIntent#'));
      expect(depositIntent).toBeDefined();
      expect(depositIntent!['__typename']).toBe('DepositIntent');
      expect(depositIntent!['amountCents']).toBe(100_000);
      expect(depositIntent!['status']).toBe('INITIATED');

      // No stale per-entity rows should exist post-resplit
      expect(items.find((i) => i['sk'] === 'RiskProfile')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'MandateStatus')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'OperatingMode')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'AccountMode')).toBeUndefined();
      expect(items.find((i) => String(i['sk']).startsWith('Goal#'))).toBeUndefined();

      // Event assertions — composite row → INVESTOR_PROFILE_CREATED;
      // Mandate row → MANDATE_ISSUED. NEVER per-field events.
      // waitForEvent polls SQS in a loop, robust to SQS-sample races where
      // a single drain() may not surface all messages. 90s matches the
      // ctx.timings.eventTimeout default — CDC for two rows in one transactWrite
      // can straddle DDB stream batches and exceed a 60s budget.
      const created = await trap.waitForEvent({
        detailType: 'INVESTOR_PROFILE_CREATED',
        timeoutMs: 90_000,
      });
      const accepted = await trap.waitForEvent({
        detailType: 'MANDATE_ISSUED',
        timeoutMs: 90_000,
      });
      expect(created.detailType).toBe('INVESTOR_PROFILE_CREATED');
      expect(accepted.detailType).toBe('MANDATE_ISSUED');
      expect((accepted.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBe(1);

      // Drain residual events to assert legacy per-field events are NOT emitted.
      const residual = (await trap.drain()).map((e) => e.detailType);
      expect(residual).not.toContain('GOAL_CREATED');
      expect(residual).not.toContain('RISK_PROFILE_CREATED');
      expect(residual).not.toContain('MANDATE_CREATED');
      expect(residual).not.toContain('OPERATING_MODE_SELECTED');
    }, 180_000);

    it('should set executionMode to live on GO_LIVE_CONFIRMED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      // InvestorProfile already exists from ONBOARDING_COMPLETED materialization test.
      await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${userId}`,
        sk: 'InvestorProfile',
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'GO_LIVE_CONFIRMED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
        },
      });

      // Verify ExecutionModeChange record was created
      let modeChangeItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !modeChangeItem) {
        const items = await table.queryItems({
          table: 'investor-bff',
          pk,
          skPrefix: 'ExecutionModeChange#',
        });
        modeChangeItem = items.find((i) => i['__typename'] === 'ExecutionModeChange');
        if (!modeChangeItem) await new Promise((r) => setTimeout(r, 2_000));
      }
      expect(modeChangeItem).toBeDefined();
      expect(modeChangeItem!['toMode']).toBe('live');
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    beforeAll(async () => {
      // Clear any leftover circuit-breaker feature flags from previous runs
      await table.cleanup({ table: 'investor-bff', pk: 'FeatureFlag#SYSTEM' });
    }, 30_000);

    it('should write a DepositIntent outbox row and emit DEPOSIT_INITIATED', async () => {
      const clientDepositId = crypto.randomUUID();
      const result = await appsync.mutate<{
        initiateDeposit: {
          depositId: string;
          amountCents: number;
          currency: string;
          status: string;
          initiatedAt: string;
        };
      }>(
        `
        mutation InitiateDeposit($input: DepositInput!) {
          initiateDeposit(input: $input) {
            depositId
            amountCents
            currency
            status
            initiatedAt
          }
        }
      `,
        {
          input: { depositId: clientDepositId, amountCents: 100_000, currency: 'USD' },
        },
      );

      // Optimistic return — the projected Deposit read-model row is materialized
      // later from broker-ctrl's lifecycle events, not by this resolver.
      expect(result.initiateDeposit.status).toBe('INITIATED');
      expect(result.initiateDeposit.amountCents).toBe(100_000);
      expect(result.initiateDeposit.currency).toBe('USD');
      expect(result.initiateDeposit.depositId).toBe(clientDepositId);
      const depositId = result.initiateDeposit.depositId;

      // Assert: DepositIntent outbox row in DDB (NOT a projected Deposit row)
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        sk: `DepositIntent#${depositId}`,
      });
      expect(item['amountCents']).toBe(100_000);
      expect(item['status']).toBe('INITIATED');
      expect(item['__typename']).toBe('DepositIntent');

      // No projected Deposit row should exist yet (no lifecycle event emitted)
      await expect(
        table.waitForItem({
          table: 'investor-bff',
          pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
          sk: `Deposit#${depositId}`,
          timeoutMs: 5_000,
        }),
      ).rejects.toThrow();

      // Assert: CDC event on EventBridge — DEPOSIT_INITIATED from the outbox row
      const event = await trap.waitForEvent<BusEventPayload>({
        detailType: 'DEPOSIT_INITIATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('DEPOSIT_INITIATED');
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 120_000);

    it('materializes the Deposit P1 row from lifecycle v2→v3 with monotonic __version (stale dropped)', async () => {
      const transferId = crypto.randomUUID();
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const sk = `Deposit#${transferId}`;

      // Emit DEPOSIT_DETECTED (v2) — broker-ctrl's funding snapshot shape.
      // investor-adpt forwards execution→investor; here we emit directly on
      // investorBus, which is what the ingress handler consumes.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          status: 'detected',
          transferId,
          amountCents: 250_000,
          currency: 'USD',
          initiatedAt: '2026-01-01T00:00:00.000Z',
          detectedAt: '2026-01-02T00:00:00.000Z',
          __version: 2,
        },
      });

      const detected = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk,
        match: { status: 'DETECTED' },
        timeoutMs: 60_000,
      });
      expect(detected['__typename']).toBe('Deposit');
      expect(detected['depositId']).toBe(transferId);
      expect(detected['__version']).toBe(2);

      // Emit DEPOSIT_SETTLED (v3) — must win (monotonic version).
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_SETTLED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          status: 'settled',
          transferId,
          amountCents: 250_000,
          currency: 'USD',
          initiatedAt: '2026-01-01T00:00:00.000Z',
          detectedAt: '2026-01-02T00:00:00.000Z',
          settledAt: '2026-01-03T00:00:00.000Z',
          __version: 3,
        },
      });

      const settled = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk,
        match: { status: 'SETTLED' },
        timeoutMs: 60_000,
      });
      expect(settled['__version']).toBe(3);
      expect(settled['settledAt']).toBe('2026-01-03T00:00:00.000Z');

      // Re-emit a STALE lower version (v2) — projectVersioned guard drops it,
      // so the row stays at v3/SETTLED.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          status: 'detected',
          transferId,
          amountCents: 250_000,
          currency: 'USD',
          initiatedAt: '2026-01-01T00:00:00.000Z',
          detectedAt: '2026-01-02T00:00:00.000Z',
          __version: 2,
        },
      });

      // Allow time for the stale event to be (wrongly) applied if the guard failed.
      await new Promise((r) => setTimeout(r, 10_000));
      const afterStale = await table.waitForItem({ table: 'investor-bff', pk, sk });
      expect(afterStale['__version']).toBe(3);
      expect(afterStale['status']).toBe('SETTLED');
    }, 180_000);

    it('should write a WithdrawalIntent outbox row and emit WITHDRAWAL_INITIATED (funds available)', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Event-driven fixture: BALANCE_UPDATED materializes CashBalance at InvestorProfile# pk.
      // Version-guard CashBalance with a high lastEventSequence so this balance wins.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          cashBalanceCents: 1_000_000,
          snapshot: { positions: {}, cashBalanceCents: 1_000_000, lastEventSequence: 1000 },
        },
      });
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'CashBalance',
        predicate: (i) => Number(i['cashBalanceCents']) >= 1_000_000,
        description: 'CashBalance >= 1,000,000',
        timeoutMs: 60_000,
      });

      const result = await appsync.mutate<{
        requestWithdrawal: {
          withdrawalId: string;
          amountCents: number;
          currency: string;
          status: string;
          requestedAt: string;
        };
      }>(
        `
        mutation RequestWithdrawal($input: WithdrawalInput!) {
          requestWithdrawal(input: $input) {
            withdrawalId
            amountCents
            currency
            status
            requestedAt
          }
        }
      `,
        {
          input: { amountCents: 50_000, currency: 'USD' },
        },
      );

      expect(result.requestWithdrawal.status).toBe('REQUESTED');
      expect(result.requestWithdrawal.amountCents).toBe(50_000);
      const withdrawalId = result.requestWithdrawal.withdrawalId;

      // Assert: WithdrawalIntent outbox row in DDB (NOT a projected WithdrawalRequest row)
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: `WithdrawalIntent#${withdrawalId}`,
      });
      expect(item['status']).toBe('REQUESTED');
      expect(item['__typename']).toBe('WithdrawalIntent');

      // Assert: CashBalance was NOT debited — ledger-ctrl debits on settlement,
      // the resolver only ConditionChecks funds.
      const balance = await table.waitForItem({ table: 'investor-bff', pk, sk: 'CashBalance' });
      expect(Number(balance['cashBalanceCents'])).toBe(1_000_000);

      // Assert: CDC event on EventBridge — WITHDRAWAL_INITIATED from the outbox row
      const event = await trap.waitForEvent({
        detailType: 'WITHDRAWAL_INITIATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('WITHDRAWAL_INITIATED');
    }, 120_000);

    it('should reject requestWithdrawal with InsufficientFundsError and write NO intent row', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // CashBalance is 1,000,000 from the prior test; request far more than that.
      await table.waitForItem({ table: 'investor-bff', pk, sk: 'CashBalance', timeoutMs: 30_000 });

      const intentsBefore = await table.queryItems({
        table: 'investor-bff',
        pk,
        skPrefix: 'WithdrawalIntent#',
      });

      await expect(
        appsync.mutate(
          `
          mutation RequestWithdrawal($input: WithdrawalInput!) {
            requestWithdrawal(input: $input) {
              withdrawalId
              status
            }
          }
        `,
          { input: { amountCents: 999_999_999, currency: 'USD' } },
        ),
      ).rejects.toThrow(/Insufficient funds|InsufficientFundsError/i);

      // No new WithdrawalIntent row should have been written by the failed txn.
      const intentsAfter = await table.queryItems({
        table: 'investor-bff',
        pk,
        skPrefix: 'WithdrawalIntent#',
      });
      expect(intentsAfter.length).toBe(intentsBefore.length);
    }, 120_000);

    it('should update goal on composite row and emit INVESTOR_PROFILE_UPDATED', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Pre-condition: composite InvestorProfile row with goal group exists
      // (created by ONBOARDING_COMPLETED materialization test above).
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 30_000,
      });

      // updateGoal(input: GoalInput!) → patches profile.goal.<field>
      // No goalId argument — single goal per profile post-collapse.
      const result = await appsync.mutate<{
        updateGoal: {
          objective: string;
          targetAmountCents: number;
          currency: string;
          timeHorizonMonths: number;
          targetReturn: number;
        };
      }>(
        `
        mutation UpdateGoal($input: GoalInput!) {
          updateGoal(input: $input) {
            objective
            targetAmountCents
            currency
            timeHorizonMonths
            targetReturn
          }
        }
      `,
        {
          input: {
            objective: 'Updated objective',
            targetAmountCents: 750_000,
            currency: 'USD',
            timeHorizonMonths: 72,
            targetReturn: 0.08,
          },
        },
      );

      expect(result.updateGoal.objective).toBe('Updated objective');
      expect(result.updateGoal.targetAmountCents).toBe(750_000);
      expect(result.updateGoal.timeHorizonMonths).toBe(72);

      // Assert: composite row's goal group updated in DDB
      const profile = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 30_000,
      });
      const goal = profile['goal'] as Record<string, unknown>;
      expect(goal['objective']).toBe('Updated objective');
      expect(goal['targetAmountCents']).toBe(750_000);
      // updateGoal's if_not_exists(#v,:zero)+:one bumped __version past the seed's 1.
      expect(Number(profile['__version'])).toBeGreaterThan(1);

      // Assert: CDC event — modify on InvestorProfile row → INVESTOR_PROFILE_UPDATED
      const event = await trap.waitForEvent({
        detailType: 'INVESTOR_PROFILE_UPDATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('INVESTOR_PROFILE_UPDATED');
      expect((event.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBeGreaterThan(1);
    }, 120_000);

    it('should revoke mandate and flip Mandate row to REVOKED + emit MANDATE_REVOKED (no INVESTOR_PROFILE_UPDATED)', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Snapshot the composite InvestorProfile row's updatedAt BEFORE the revoke
      // to assert it was NOT touched (post-resplit: revokeMandate writes only
      // the Mandate sibling row, never the composite InvestorProfile row).
      const profileBefore = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
      });
      const updatedAtBefore = profileBefore['updatedAt'];

      const result = await appsync.mutate<{
        revokeMandate: {
          status: string;
          revokedAt: string;
        };
      }>(
        `
        mutation RevokeMandate {
          revokeMandate {
            status
            revokedAt
          }
        }
      `,
        {},
      );

      expect(result.revokeMandate.status).toBe('REVOKED');
      expect(result.revokeMandate.revokedAt).toBeTruthy();

      // Assert: Mandate row (sk='Mandate') flipped to REVOKED
      const mandateRow = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'Mandate',
      });
      expect(mandateRow['status']).toBe('REVOKED');
      expect(mandateRow['revokedAt']).toBeTruthy();

      // Assert: composite InvestorProfile row NOT touched — revokeMandate.fn.js
      // targets sk='Mandate' only, never the composite row.
      const profileAfter = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
      });
      expect(profileAfter['updatedAt']).toBe(updatedAtBefore);

      // Assert: CDC modify on Mandate row → MANDATE_REVOKED
      const revoked = await trap.waitForEvent({
        detailType: 'MANDATE_REVOKED',
        timeoutMs: 60_000,
      });
      expect(revoked.detailType).toBe('MANDATE_REVOKED');
      expect((revoked.detail as { subject?: Record<string, unknown> }).subject?.['__version']).toBe(2);

      // Note: "NO INVESTOR_PROFILE_UPDATED emitted" is enforced by
      // construction at the resolver level (revoke-mandate.fn.js targets
      // sk='Mandate', never the composite InvestorProfile row) and is
      // unit-tested in test/unit/graphql/revoke-mandate.test.ts. Adding a
      // negative-event assertion here would either be racy (drain only sees
      // the past) or destructive (drain consumes the buffer that subsequent
      // tests rely on). The composite-row no-touch invariant is asserted
      // above via profileAfter['updatedAt'] === updatedAtBefore on the raw DDB row.
    }, 120_000);

    it('should reject double-revoke with InvalidState', async () => {
      // First revoke happened in the previous test in this describe block;
      // attempting a second revoke must surface InvalidState (precondition
      // status=ACCEPTED fails because status is now REVOKED).
      await expect(
        appsync.mutate<{
          revokeMandate: { status: string; revokedAt: string };
        }>(
          `
          mutation RevokeMandate {
            revokeMandate {
              status
              revokedAt
            }
          }
        `,
          {},
        ),
      ).rejects.toThrow(/InvalidState|not active|already revoked/i);
    }, 60_000);

    it('should return REQUESTED status for requestAccountClosure', async () => {
      // requestAccountClosure uses noneDataSource — no DDB write, no CDC
      const result = await appsync.mutate<{
        requestAccountClosure: { closureId: string; status: string; requestedAt: string };
      }>(
        `
        mutation RequestAccountClosure {
          requestAccountClosure {
            closureId
            status
            requestedAt
          }
        }
      `,
        {},
      );

      expect(result.requestAccountClosure.status).toBe('REQUESTED');
      expect(result.requestAccountClosure.closureId).toBeTruthy();
      expect(result.requestAccountClosure.requestedAt).toBeTruthy();
    }, 60_000);

    it('should mark notification as read and emit NOTIFICATION_READ', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const notificationId = `integ-notif-read-${Date.now()}`;

      // Event-driven fixture: NOTIFICATION_CREATED creates the notification at the correct pk
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'NOTIFICATION_CREATED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          notificationId,
          channel: 'IN_APP',
          title: 'Test notification',
          body: 'Test body',
          relatedEntityType: 'Goal',
          relatedEntityId: 'goal-xyz',
        },
      });

      // Wait for notification to materialize
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: `Notification#${notificationId}`,
        timeoutMs: 60_000,
      });

      const result = await appsync.mutate<{
        markNotificationRead: {
          notificationId: string;
          status: string;
          readAt: string;
        };
      }>(
        `
        mutation MarkNotificationRead($notificationId: ID!) {
          markNotificationRead(notificationId: $notificationId) {
            notificationId
            status
            readAt
          }
        }
      `,
        { notificationId },
      );

      expect(result.markNotificationRead.notificationId).toBe(notificationId);
      expect(result.markNotificationRead.status).toBe('READ');
      expect(result.markNotificationRead.readAt).toBeTruthy();

      // Assert: Notification status updated in DDB
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: `Notification#${notificationId}`,
      });
      expect(item['status']).toBe('READ');

      // Assert: CDC event on EventBridge
      const event = await trap.waitForEvent({ detailType: 'NOTIFICATION_READ', timeoutMs: 60_000 });
      expect(event.detailType).toBe('NOTIFICATION_READ');
    }, 120_000);
  });

  // ── AppSync Queries ─────────────────────────────────────────────────

  describe('AppSync queries', () => {
    const profilePk = () => `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

    beforeAll(async () => {
      // The ONBOARDING_COMPLETED materialization test (above) already wrote
      // the composite InvestorProfile row at InvestorProfile#<tenantId>#<cognitoSub>.
      // Wait for the goal group to be present (last-written portion of the
      // transactWrite Put — its presence is the strongest signal the
      // composite row is hydrated).
      await table.waitForItem({
        table: 'investor-bff',
        pk: profilePk(),
        sk: 'InvestorProfile',
        predicate: (i) => i['operatingMode'] === 'BALANCED' && !!i['goal'],
        description: 'InvestorProfile row with operatingMode=BALANCED and goal',
        timeoutMs: 90_000,
      });
    }, 120_000);

    it('should return composite InvestorProfile via getProfile', async () => {
      // Post-collapse: getProfile returns the FULL composite row including
      // nested goal / riskProfile / mandate / accountMode groups.
      const result = await appsync.query<{
        getProfile: {
          tenantId: string;
          userId: string;
          operatingMode: string;
          goal: { objective: string; currency: string; timeHorizonMonths: number };
          mandate: { mandateId: string; level: string; status: string };
          accountMode: { mode: string; capitalAmount: number; currency: string };
        };
      }>(
        `
        query GetProfile {
          getProfile {
            tenantId
            userId
            operatingMode
            goal {
              objective
              currency
              timeHorizonMonths
            }
            mandate {
              mandateId
              level
              status
            }
            accountMode {
              mode
              capitalAmount
              currency
            }
          }
        }
      `,
        {},
      );

      expect(result.getProfile.tenantId).toBe(ctx.tenantId);
      expect(result.getProfile.userId).toBe(cognitoSub);
      expect(result.getProfile.operatingMode).toBe('BALANCED');
      // Goal nested group — was the standalone `getGoals` query pre-collapse
      expect(result.getProfile.goal).toBeDefined();
      expect(result.getProfile.goal.objective).toBeTruthy();
      expect(result.getProfile.goal.currency).toBe('USD');
      // Mandate nested group — fetched from the Mandate sibling row (sk='Mandate')
      // by the get-profile-mandate.fn.js pipeline step and merged onto the response.
      // The prior describe ('AppSync mutations') ran revokeMandate, so
      // Mandate.status is now 'REVOKED' — getProfile reflects that.
      expect(result.getProfile.mandate).toBeDefined();
      expect(result.getProfile.mandate.mandateId).toBeTruthy();
      expect(result.getProfile.mandate.status).toBe('REVOKED');
      // AccountMode nested group
      expect(result.getProfile.accountMode).toBeDefined();
      expect(result.getProfile.accountMode.mode).toBe('simulation');
    }, 60_000);

    it('getDeposit returns the projected Deposit row materialized from a lifecycle event', async () => {
      // getDeposit reads the projected Deposit P1 row (sk=Deposit#<id>), which is
      // now materialized from broker-ctrl's funding lifecycle — NOT from
      // initiateDeposit (which writes a DepositIntent outbox row). Seed via a
      // DEPOSIT_SETTLED lifecycle event, then read it back.
      const transferId = crypto.randomUUID();
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_SETTLED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          status: 'settled',
          transferId,
          amountCents: 5_000,
          currency: 'USD',
          initiatedAt: '2026-01-01T00:00:00.000Z',
          settledAt: '2026-01-03T00:00:00.000Z',
          __version: 3,
        },
      });

      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: `Deposit#${transferId}`,
        match: { status: 'SETTLED' },
        timeoutMs: 60_000,
      });

      const result = await appsync.query<{
        getDeposit: {
          depositId: string;
          amountCents: number;
          currency: string;
          status: string;
        };
      }>(
        `
        query GetDeposit($depositId: ID!) {
          getDeposit(depositId: $depositId) {
            depositId
            amountCents
            currency
            status
          }
        }
      `,
        { depositId: transferId },
      );

      expect(result.getDeposit).toEqual(
        expect.objectContaining({
          depositId: transferId,
          amountCents: 5_000,
          currency: 'USD',
          status: 'SETTLED',
        }),
      );
    }, 120_000);

    it('getDeposit throws NotFoundError for an unknown depositId', async () => {
      const depositId = crypto.randomUUID();
      await expect(
        appsync.query(
          `
          query GetDeposit($depositId: ID!) {
            getDeposit(depositId: $depositId) { depositId }
          }
        `,
          { depositId },
        ),
      ).rejects.toThrow(/Deposit not found|NotFoundError/);
    }, 60_000);
  });

  // ── Circuit Breaker Feature Flags ────────────────────────────────────

  describe('circuit breaker feature flags', () => {
    const FLAG_NAMES = ['confirmDecision', 'initiateDeposit', 'requestWithdrawal'] as const;

    const GET_FEATURE_FLAGS = `
      query GetFeatureFlags {
        getFeatureFlags {
          name
          enabled
          reason
        }
      }
    `;

    async function waitForFlags(
      expectedEnabled: boolean,
      timeoutMs = 90_000,
    ): Promise<Array<{ name: string; enabled: boolean; reason: string | null }>> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await appsync.query<{
          getFeatureFlags: Array<{ name: string; enabled: boolean; reason: string | null }>;
        }>(GET_FEATURE_FLAGS, {});

        const targetFlags = result.getFeatureFlags.filter(f =>
          (FLAG_NAMES as readonly string[]).includes(f.name),
        );
        if (
          targetFlags.length === FLAG_NAMES.length &&
          targetFlags.every(f => f.enabled === expectedEnabled)
        ) {
          return targetFlags;
        }
        await new Promise(r => setTimeout(r, 2_000));
      }
      throw new Error(`Timeout: flags not ${expectedEnabled ? 'enabled' : 'disabled'} after ${timeoutMs}ms`);
    }

    it('should disable feature flags on BROKER_CIRCUIT_OPEN', async () => {
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BROKER_CIRCUIT_OPEN',
        detail: {},
      });

      const flags = await waitForFlags(false);

      for (const flag of flags) {
        expect(flag.enabled).toBe(false);
        expect(flag.reason).toBe('Broker connectivity issue');
      }
    }, 120_000);

    it('should re-enable feature flags on BROKER_CIRCUIT_CLOSED', async () => {
      // Flags are already disabled from the preceding BROKER_CIRCUIT_OPEN test.
      // Sending a redundant OPEN here would race with CLOSED via SQS reordering.

      // Act: close the breaker
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BROKER_CIRCUIT_CLOSED',
        detail: {},
      });

      const flags = await waitForFlags(true);

      for (const flag of flags) {
        expect(flag.enabled).toBe(true);
      }
    }, 210_000); // Two full event→mutation→poll cycles under parallel load
  });

});
