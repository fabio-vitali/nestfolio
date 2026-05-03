import {
  createTestContext,
  CognitoFixture,
  AppSyncClient,
  EventBridgeClient,
  type TestContext,
} from '@nestfolio/test-support';
import {
  EventBusTrap,
  TableAssertions,
  StateResetFixture,
  OrphanReaper,
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
   * The composite design has at most: 1× InvestorProfile + 1× MandateStatus +
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
    ctx = await createTestContext();
    await new OrphanReaper(ctx).cleanup();

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
    // (post-collapse — composite row → INVESTOR_PROFILE_CREATED/UPDATED +
    //  MandateStatus row → MANDATE_ACCEPTED/MANDATE_REVOKED).
    await trap.deploy({
      bus: 'investor',
      detailType: [
        'DEPOSIT_INITIATED',
        'WITHDRAWAL_REQUESTED',
        'INVESTOR_PROFILE_CREATED',
        'INVESTOR_PROFILE_UPDATED',
        'MANDATE_ACCEPTED',
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
    it('should materialize InvestorProfile on USER_REGISTERED', async () => {
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

      // user-registered transform writes the bare InvestorProfile row
      // (no goal/riskProfile/mandate yet — those are filled by ONBOARDING_COMPLETED).
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${userId}`,
        sk: 'InvestorProfile',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('InvestorProfile');
      expect(item['email']).toBe(`${userId}@integ-test.example`);
      expect(item['userId']).toBe(userId);
    }, 120_000);

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
        },
      });

      // project('CashBalance', ...) with overrides → pk: InvestorProfile#<tenantId>#<userId>, sk: CashBalance
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'CashBalance',
        timeoutMs: 60_000,
      });

      expect(item['__typename']).toBe('CashBalance');
      expect(item['cashBalanceCents']).toBe(500_000);
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

    it('should atomically write composite InvestorProfile + MandateStatus on ONBOARDING_COMPLETED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      // Pre-condition — race-safe USER_REGISTERED before ONBOARDING_COMPLETED.
      // user-registered transform uses record() (putIfNotExists); the subsequent
      // ONBOARDING_COMPLETED transactWrite Puts the same pk/sk:'InvestorProfile'
      // — which will clobber any record()-written stub. We still emit
      // USER_REGISTERED first to mirror production flow.
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

      // Wait for InvestorProfile stub to exist before sending ONBOARDING_COMPLETED
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 60_000,
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

      // Wait for the composite InvestorProfile row's `mandate` group to appear
      // (last-written attribute in the transactWrite Put — its presence is the
      // strongest signal the composite row is hydrated).
      let profileItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        profileItem = await table.waitForItem({
          table: 'investor-bff',
          pk,
          sk: 'InvestorProfile',
          timeoutMs: 5_000,
        });
        if (profileItem['mandate']) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }

      // Composite assertions — ONE row, nested groups
      const items = await getInvestorProfileItems(ctx.tenantId, userId);
      const profile = items.find((i) => i['sk'] === 'InvestorProfile')!;
      const status = items.find((i) => i['sk'] === 'MandateStatus')!;

      expect(profile).toBeDefined();
      expect(profile['__typename']).toBe('InvestorProfile');
      expect(profile['operatingMode']).toBe('BALANCED');
      expect(profile['onboardingCompletedAt']).toBeDefined();

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

      // Mandate config (BALANCED guardrails) lives nested under profile.mandate
      const mandate = profile['mandate'] as Record<string, unknown>;
      expect(mandate).toBeDefined();
      expect(mandate['level']).toBeDefined();
      expect(mandate['maxSingleTradePercent']).toBe(10);
      expect(mandate['monthlyTurnoverCapPercent']).toBe(25);
      expect(mandate['rebalanceCadence']).toBe('MONTHLY');
      expect(mandate['equityRiskBandPercent']).toBe(6);
      expect(mandate['driftTriggerPercent']).toBe(4);
      expect(mandate['singleEtfConcentrationPercent']).toBe(30);
      expect(mandate['drawdownCircuitBreakerPercent']).toBe(12);

      // MandateStatus is a SIBLING row (lifecycle decoupled from config)
      expect(status).toBeDefined();
      expect(status['__typename']).toBe('MandateStatus');
      expect(status['status']).toBe('ACCEPTED');
      expect(status['acceptedAt']).toBeDefined();

      // Deposit row (capitalAmount > 0)
      const deposit = items.find((i) => String(i['sk']).startsWith('Deposit#'));
      expect(deposit).toBeDefined();
      expect(deposit!['amountCents']).toBe(100_000);
      expect(deposit!['status']).toBe('INITIATED');

      // No per-entity rows should exist post-collapse
      expect(items.find((i) => i['sk'] === 'RiskProfile')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'Mandate')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'OperatingMode')).toBeUndefined();
      expect(items.find((i) => i['sk'] === 'AccountMode')).toBeUndefined();
      expect(items.find((i) => String(i['sk']).startsWith('Goal#'))).toBeUndefined();

      // Event assertions — composite row → INVESTOR_PROFILE_CREATED;
      // MandateStatus row → MANDATE_ACCEPTED. NEVER per-field events.
      const buffered = await trap.drain();
      const eventTypes = buffered.map((e) => e.detailType);
      expect(eventTypes).toEqual(
        expect.arrayContaining(['INVESTOR_PROFILE_CREATED', 'MANDATE_ACCEPTED']),
      );
      expect(eventTypes).not.toContain('GOAL_CREATED');
      expect(eventTypes).not.toContain('RISK_PROFILE_CREATED');
      expect(eventTypes).not.toContain('MANDATE_CREATED');
      expect(eventTypes).not.toContain('OPERATING_MODE_SELECTED');
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

    // TODO Phase 7: re-enable / replace once setOperatingMode mutation lands.
    // OPERATING_MODE_CHANGED was an event-listener subscription that updated
    // the standalone `Mandate` row's guardrail params. Post-collapse:
    //   1. The InvestorProfile.mandate group is now updated via the
    //      `updateMandate(input: MandateInput!)` mutation (no event-driven path).
    //   2. event-listener.ts no longer subscribes to OPERATING_MODE_CHANGED
    //      (Task 1.10 will drop the transform + handler subscription).
    // Phase 7 may introduce a `setOperatingMode` mutation that updates
    // profile.operatingMode + cascades guardrails — assertion shape will
    // mirror the updateMandate test below.
    it.skip('should update Mandate guardrail params on OPERATING_MODE_CHANGED', async () => {
      // Intentionally empty — see TODO above.
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    beforeAll(async () => {
      // Clear any leftover circuit-breaker feature flags from previous runs
      await table.cleanup({ table: 'investor-bff', pk: 'FeatureFlag#SYSTEM' });
    }, 30_000);

    it('should create deposit record and emit DEPOSIT_INITIATED', async () => {
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
          input: { amountCents: 100_000, currency: 'USD' },
        },
      );

      expect(result.initiateDeposit.status).toBe('INITIATED');
      expect(result.initiateDeposit.amountCents).toBe(100_000);
      expect(result.initiateDeposit.currency).toBe('USD');
      const depositId = result.initiateDeposit.depositId;

      // Assert: Deposit record in DDB
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        sk: `Deposit#${depositId}`,
      });
      expect(item['amountCents']).toBe(100_000);
      expect(item['status']).toBe('INITIATED');
      expect(item['__typename']).toBe('Deposit');

      // Assert: CDC event on EventBridge
      const event = await trap.waitForEvent<BusEventPayload>({
        detailType: 'DEPOSIT_INITIATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('DEPOSIT_INITIATED');
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 120_000);

    it('should create withdrawal record and emit WITHDRAWAL_REQUESTED', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Event-driven fixture: BALANCE_UPDATED materializes CashBalance at InvestorProfile# pk
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'BALANCE_UPDATED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          cashBalanceCents: 1_000_000,
        },
      });
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'CashBalance',
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

      // Assert: Withdrawal record in DDB
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: `Withdrawal#${withdrawalId}`,
      });
      expect(item['status']).toBe('REQUESTED');
      expect(item['__typename']).toBe('Withdrawal');

      // Assert: CDC event on EventBridge
      const event = await trap.waitForEvent({
        detailType: 'WITHDRAWAL_REQUESTED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('WITHDRAWAL_REQUESTED');
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

      // Assert: CDC event — modify on InvestorProfile row → INVESTOR_PROFILE_UPDATED
      const event = await trap.waitForEvent({
        detailType: 'INVESTOR_PROFILE_UPDATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('INVESTOR_PROFILE_UPDATED');
    }, 120_000);

    it('should update mandate guardrails on composite row and emit INVESTOR_PROFILE_UPDATED', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Pre-condition: composite InvestorProfile row with mandate group exists
      // (created by ONBOARDING_COMPLETED materialization test above).
      await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 30_000,
      });

      // updateMandate(input: MandateInput!) → patches profile.mandate.<field>
      const result = await appsync.mutate<{
        updateMandate: {
          mandateId: string;
          level: string;
          status: string;
          monthlyTurnoverCapPercent: number;
          maxSingleTradePercent: number;
          rebalanceCadence: string;
        };
      }>(
        `
        mutation UpdateMandate($input: MandateInput!) {
          updateMandate(input: $input) {
            mandateId
            level
            status
            monthlyTurnoverCapPercent
            maxSingleTradePercent
            rebalanceCadence
          }
        }
      `,
        {
          input: {
            level: 'DISCRETIONARY',
            monthlyTurnoverCapPercent: 10,
            maxSingleTradePercent: 5,
            rebalanceCadence: 'MONTHLY',
          },
        },
      );

      expect(result.updateMandate.level).toBe('DISCRETIONARY');
      expect(result.updateMandate.monthlyTurnoverCapPercent).toBe(10);
      expect(result.updateMandate.maxSingleTradePercent).toBe(5);

      // Assert: composite row's mandate group updated in DDB
      const profile = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 30_000,
      });
      const mandate = profile['mandate'] as Record<string, unknown>;
      expect(mandate['level']).toBe('DISCRETIONARY');
      expect(mandate['monthlyTurnoverCapPercent']).toBe(10);
      expect(mandate['rebalanceCadence']).toBe('MONTHLY');

      // Assert: CDC event — modify on InvestorProfile row → INVESTOR_PROFILE_UPDATED
      const event = await trap.waitForEvent({
        detailType: 'INVESTOR_PROFILE_UPDATED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('INVESTOR_PROFILE_UPDATED');
    }, 120_000);

    // TODO Phase 5: re-enable after revoke-mandate.fn.js rewrite
    // (single UpdateItem on MandateStatus row → modify CDC → MANDATE_REVOKED).
    // Today's revoke-mandate.fn.js still writes a MandateRevocation# row
    // (legacy half-implementation latent bug — see PARKING LOT entry filed
    // 2026-05-03). Phase 5 rewrites it to flip MandateStatus.status = REVOKED;
    // CDC then emits MANDATE_REVOKED via the Egress map added in Task 1.4.
    it.skip('should revoke mandate and flip MandateStatus to REVOKED + emit MANDATE_REVOKED', async () => {
      // Intentionally empty — see TODO above.
      const result = await appsync.mutate<{
        revokeMandate: {
          status: string;
          acceptedAt: string;
          revokedAt: string;
        };
      }>(
        `
        mutation RevokeMandate {
          revokeMandate {
            status
            acceptedAt
            revokedAt
          }
        }
      `,
        {},
      );

      expect(result.revokeMandate.status).toBe('REVOKED');
      expect(result.revokeMandate.revokedAt).toBeTruthy();

      // Assert: MandateStatus sibling row flipped to REVOKED
      const status = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        sk: 'MandateStatus',
      });
      expect(status['status']).toBe('REVOKED');
      expect(status['revokedAt']).toBeTruthy();

      // Assert: CDC modify on MandateStatus row → MANDATE_REVOKED
      const event = await trap.waitForEvent({
        detailType: 'MANDATE_REVOKED',
        timeoutMs: 60_000,
      });
      expect(event.detailType).toBe('MANDATE_REVOKED');
    }, 120_000);

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
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const item = await table.waitForItem({
          table: 'investor-bff',
          pk: profilePk(),
          sk: 'InvestorProfile',
          timeoutMs: 5_000,
        });
        if (item['operatingMode'] === 'BALANCED' && item['goal']) break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
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
      // Mandate nested group with status from MandateStatus sibling (resolver
      // joins them) — see spec §"Read path" / Task 1.7.
      expect(result.getProfile.mandate).toBeDefined();
      expect(result.getProfile.mandate.mandateId).toBeTruthy();
      expect(result.getProfile.mandate.status).toBe('ACTIVE');
      // AccountMode nested group
      expect(result.getProfile.accountMode).toBeDefined();
      expect(result.getProfile.accountMode.mode).toBe('simulation');
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

  describe('deposit event subscription pipeline', () => {
    it('flips DepositIntent status to DETECTED when DEPOSIT_DETECTED is received', async () => {
      // Create the DepositIntent row first — the publish-deposit-event resolver has
      // attribute_exists(pk) and will fail silently (conditional) if no row exists.
      const seedResult = await appsync.mutate<{
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
        { input: { amountCents: 250_000, currency: 'USD' } },
      );

      const depositId = seedResult.initiateDeposit.depositId;
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const sk = `Deposit#${depositId}`;

      // Confirm seed row is INITIATED
      const seeded = await table.waitForItem({ table: 'investor-bff', pk, sk });
      expect(seeded['status']).toBe('INITIATED');

      // Act — emit DEPOSIT_DETECTED on investorBus (investor-adpt already routes
      // DEPOSIT_DETECTED from executionBus → investorBus; here we bypass the adapter
      // and emit directly on investorBus, which is what the ingress handler consumes).
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'DEPOSIT_DETECTED',
        detail: {
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          depositId,
          amountCents: 250_000,
          currency: 'USD',
        },
      });

      // Assert — DDB row status advances to DETECTED
      const updated = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk,
        match: { status: 'DETECTED' },
        timeoutMs: 60_000,
      });

      expect(updated['status']).toBe('DETECTED');
      expect(updated['occurredAt']).toBeDefined();
    }, 120_000);
  });
});
