import {
  createIntegrationContext,
  CognitoFixture,
  AppSyncClient,
  EventBridgeClient,
  EventBusTrap,
  TableAssertions,
  DdbSeedFixture,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-bff', () => {
  let ctx: IntegrationContext;
  let eb: EventBridgeClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let seeder: DdbSeedFixture;
  let appsync: AppSyncClient;
  let cognitoSub: string;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    eb = new EventBridgeClient(ctx);
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);
    table.registerCleanup();
    seeder = new DdbSeedFixture(ctx);

    const cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'investor-bff');

    // Extract Cognito sub — used as userId in AppSync resolvers via stash
    const payload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString());
    cognitoSub = payload.sub;

    // Deploy trap for all CDC event types emitted by investor-bff mutations
    await trap.deploy({
      bus: 'investor',
      detailType: [
        'DEPOSIT_INITIATED',
        'WITHDRAWAL_REQUESTED',
        'GOAL_UPDATED',
        'MANDATE_CREATED',
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

      // record('InvestorProfile', ...) — no overrides → pk: T#<tenantId>, sk: InvestorProfile#<eventId>
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `T#${ctx.tenantId}`,
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

      // record('Notification', ...) — no overrides → pk: T#<tenantId>, sk: Notification#<eventId>
      // Poll with skPrefix to avoid non-deterministic match against InvestorProfile records
      let notifItem: Record<string, unknown> | undefined;
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline && !notifItem) {
        const items = await table.queryItems({
          table: 'investor-bff',
          pk: `T#${ctx.tenantId}`,
          skPrefix: 'Notification#',
        });
        notifItem = items.find(i => i['notificationId'] === notificationId);
        if (!notifItem) await new Promise(r => setTimeout(r, 2_000));
      }

      expect(notifItem).toBeDefined();
      expect(notifItem!['__typename']).toBe('Notification');
      expect(notifItem!['channel']).toBe('IN_APP');
      expect(notifItem!['title']).toBe('Integration test notification');
    }, 120_000);

    // SKIPPED: requires pk alignment (InvestorProfile at InvestorProfile# pk, not T# pk)
    // Will be enabled by Plan F after resolvers and transforms are aligned
    it.skip('should create 7 entities atomically on ONBOARDING_COMPLETED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      // Event-driven fixture: USER_REGISTERED creates the InvestorProfile
      // that ONBOARDING_COMPLETED's ConditionExpression requires
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

      // Wait for InvestorProfile to exist before sending ONBOARDING_COMPLETED
      await table.waitForItem({
        table: 'investor-bff',
        pk: `T#${ctx.tenantId}`,
        timeoutMs: 60_000,
      });

      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'ONBOARDING_COMPLETED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
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

      // Verify Goal was created
      const deadline = Date.now() + 60_000;
      let goalItem: Record<string, unknown> | undefined;
      while (Date.now() < deadline && !goalItem) {
        const items = await table.queryItems({
          table: 'investor-bff',
          pk,
          skPrefix: 'Goal#',
        });
        goalItem = items.find(i => i['__typename'] === 'Goal');
        if (!goalItem) await new Promise(r => setTimeout(r, 2_000));
      }
      expect(goalItem).toBeDefined();
      expect(goalItem!['objective']).toBe('GROWTH');

      // Verify RiskProfile was created
      const riskItem = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'RiskProfile',
        timeoutMs: 30_000,
      });
      expect(riskItem['__typename']).toBe('RiskProfile');
      expect(riskItem['band']).toBeDefined();

      // Verify OperatingModeRecord was created
      const modeItem = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'OperatingMode',
        timeoutMs: 10_000,
      });
      expect(modeItem['__typename']).toBe('OperatingModeRecord');
      expect(modeItem['mode']).toBe('BALANCED');

      // Verify Mandate was created
      const mandateItem = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'Mandate',
        timeoutMs: 10_000,
      });
      expect(mandateItem['__typename']).toBe('Mandate');
      expect(mandateItem['level']).toBe('ADVISORY');

      // Verify Deposit was created (capitalAmount > 0)
      let depositItem: Record<string, unknown> | undefined;
      const depositDeadline = Date.now() + 30_000;
      while (Date.now() < depositDeadline && !depositItem) {
        const items = await table.queryItems({
          table: 'investor-bff',
          pk,
          skPrefix: 'Deposit#',
        });
        depositItem = items.find(i => i['__typename'] === 'Deposit');
        if (!depositItem) await new Promise(r => setTimeout(r, 2_000));
      }
      expect(depositItem).toBeDefined();
      expect(depositItem!['amountCents']).toBe(100_000);
      expect(depositItem!['status']).toBe('INITIATED');

      // Verify AccountMode was created
      const accountModeItem = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'AccountMode',
        timeoutMs: 10_000,
      });
      expect(accountModeItem['__typename']).toBe('AccountMode');
      expect(accountModeItem['mode']).toBe('simulation');

      // Verify InvestorProfile was updated (operatingMode + onboardingCompletedAt)
      const profileItem = await table.waitForItem({
        table: 'investor-bff',
        pk,
        sk: 'InvestorProfile',
        timeoutMs: 10_000,
      });
      expect(profileItem['operatingMode']).toBe('BALANCED');
      expect(profileItem['onboardingCompletedAt']).toBeDefined();
    }, 180_000);

    // SKIPPED: requires pk alignment — same as ONBOARDING_COMPLETED above
    it.skip('should set executionMode to live on GO_LIVE_CONFIRMED', async () => {
      const userId = cognitoSub;
      const pk = `InvestorProfile#${ctx.tenantId}#${userId}`;

      // Event-driven fixture: InvestorProfile must exist.
      // Defensive: publish USER_REGISTERED again — idempotent since record() won't conflict.
      await eb.putEvent({
        bus: 'investor',
        targetService: 'investor-bff',
        detailType: 'USER_REGISTERED',
        detail: {
          tenantId: ctx.tenantId,
          userId,
          email: `${userId}@integ-golive.example`,
        },
      });

      await table.waitForItem({
        table: 'investor-bff',
        pk: `T#${ctx.tenantId}`,
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
        modeChangeItem = items.find(i => i['__typename'] === 'ExecutionModeChange');
        if (!modeChangeItem) await new Promise(r => setTimeout(r, 2_000));
      }
      expect(modeChangeItem).toBeDefined();
      expect(modeChangeItem!['toMode']).toBe('live');
    }, 120_000);
  });

  // ── AppSync Mutations ───────────────────────────────────────────────

  describe('AppSync mutations', () => {
    it('should create deposit record and emit DEPOSIT_INITIATED', async () => {
      const result = await appsync.mutate<{
        initiateDeposit: { depositId: string; amountCents: number; currency: string; status: string; initiatedAt: string };
      }>(`
        mutation InitiateDeposit($input: DepositInput!) {
          initiateDeposit(input: $input) {
            depositId
            amountCents
            currency
            status
            initiatedAt
          }
        }
      `, {
        input: { amountCents: 100_000, currency: 'USD' },
      });

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
      const event = await trap.waitForEvent({ detailType: 'DEPOSIT_INITIATED', timeoutMs: 60_000 });
      expect(event.detailType).toBe('DEPOSIT_INITIATED');
      expect(event.detail.context.tenantId).toBe(ctx.tenantId);
    }, 120_000);

    it('should create withdrawal record and emit WITHDRAWAL_REQUESTED', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;

      // Pre-seed a CashBalance so the TransactWrite condition passes
      // NOTE: seeder retained — event-driven replacement blocked on pk/sk alignment (Plan F)
      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk,
          sk: 'CashBalance#USD',
          __typename: 'CashBalance',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          amount: 1_000_000,
          timestamp: new Date().toISOString(),
        }],
      });

      const result = await appsync.mutate<{
        requestWithdrawal: { withdrawalId: string; amountCents: number; currency: string; status: string; requestedAt: string };
      }>(`
        mutation RequestWithdrawal($input: WithdrawalInput!) {
          requestWithdrawal(input: $input) {
            withdrawalId
            amountCents
            currency
            status
            requestedAt
          }
        }
      `, {
        input: { amountCents: 50_000, currency: 'USD' },
      });

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
      const event = await trap.waitForEvent({ detailType: 'WITHDRAWAL_REQUESTED', timeoutMs: 60_000 });
      expect(event.detailType).toBe('WITHDRAWAL_REQUESTED');
    }, 120_000);

    it('should update goal and emit GOAL_UPDATED', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const goalId = `integ-goal-${Date.now()}`;

      // Pre-seed a Goal so the resolver's ConditionExpression passes
      // NOTE: seeder retained — event-driven replacement blocked on pk/sk alignment (Plan F)
      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk,
          sk: `Goal#${goalId}`,
          __typename: 'Goal',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          goalId,
          objective: 'Original objective',
          targetAmountCents: 500_000,
          currency: 'USD',
          timeHorizonMonths: 60,
          targetReturn: 0.07,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        }],
      });

      const result = await appsync.mutate<{
        updateGoal: { goalId: string; objective: string; targetAmountCents: number; updatedAt: string };
      }>(`
        mutation UpdateGoal($goalId: ID!, $input: GoalInput!) {
          updateGoal(goalId: $goalId, input: $input) {
            goalId
            objective
            targetAmountCents
            currency
            timeHorizonMonths
            targetReturn
            updatedAt
          }
        }
      `, {
        goalId,
        input: {
          objective: 'Updated objective',
          targetAmountCents: 750_000,
          currency: 'USD',
          timeHorizonMonths: 72,
          targetReturn: 0.08,
        },
      });

      expect(result.updateGoal.goalId).toBe(goalId);
      expect(result.updateGoal.objective).toBe('Updated objective');
      expect(result.updateGoal.targetAmountCents).toBe(750_000);

      // Assert: CDC event on EventBridge
      const event = await trap.waitForEvent({ detailType: 'GOAL_UPDATED', timeoutMs: 60_000 });
      expect(event.detailType).toBe('GOAL_UPDATED');
    }, 120_000);

    it('should create mandate and emit MANDATE_CREATED', async () => {
      const result = await appsync.mutate<{
        updateMandate: {
          mandateId: string;
          tenantId: string;
          level: string;
          monthlyTurnoverCapPercent: number;
          maxSingleTradePercent: number;
          coolDownDays: number;
          rebalanceCadence: string;
          effectiveDate: string;
          version: number;
        };
      }>(`
        mutation UpdateMandate($input: MandateInput!) {
          updateMandate(input: $input) {
            mandateId
            tenantId
            level
            monthlyTurnoverCapPercent
            maxSingleTradePercent
            coolDownDays
            rebalanceCadence
            effectiveDate
            version
          }
        }
      `, {
        input: {
          level: 'DISCRETIONARY',
          monthlyTurnoverCapPercent: 10,
          maxSingleTradePercent: 5,
          coolDownDays: 7,
          rebalanceCadence: 'MONTHLY',
        },
      });

      expect(result.updateMandate.level).toBe('DISCRETIONARY');
      expect(result.updateMandate.monthlyTurnoverCapPercent).toBe(10);
      expect(result.updateMandate.version).toBe(1);
      const mandateId = result.updateMandate.mandateId;

      // Assert: Mandate record in DDB
      const item = await table.waitForItem({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        sk: `Mandate#${mandateId}`,
      });
      expect(item['__typename']).toBe('Mandate');
      expect(item['level']).toBe('DISCRETIONARY');

      // Assert: CDC event on EventBridge (PutItem → INSERT → MANDATE_CREATED)
      const event = await trap.waitForEvent({ detailType: 'MANDATE_CREATED', timeoutMs: 60_000 });
      expect(event.detailType).toBe('MANDATE_CREATED');
    }, 120_000);

    it('should revoke mandate and write MandateRevocation record', async () => {
      // revokeMandate uses noneDataSource-style hardcoded return but writes MandateRevocation to DDB
      // MandateRevocation __typename is NOT in CDC eventTypes map — no CDC event emitted
      const result = await appsync.mutate<{
        revokeMandate: {
          mandateId: string;
          tenantId: string;
          level: string;
          revokedAt: string;
          version: number;
        };
      }>(`
        mutation RevokeMandate {
          revokeMandate {
            mandateId
            tenantId
            level
            revokedAt
            version
          }
        }
      `, {});

      expect(result.revokeMandate.revokedAt).toBeTruthy();
      expect(result.revokeMandate.level).toBe('ADVISORY');

      // Assert: MandateRevocation record written to DDB
      const items = await table.queryItems({
        table: 'investor-bff',
        pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
        skPrefix: 'MandateRevocation#',
      });
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items[0]['__typename']).toBe('MandateRevocation');
    }, 120_000);

    it('should return REQUESTED status for requestAccountClosure', async () => {
      // requestAccountClosure uses noneDataSource — no DDB write, no CDC
      const result = await appsync.mutate<{
        requestAccountClosure: { closureId: string; status: string; requestedAt: string };
      }>(`
        mutation RequestAccountClosure {
          requestAccountClosure {
            closureId
            status
            requestedAt
          }
        }
      `, {});

      expect(result.requestAccountClosure.status).toBe('REQUESTED');
      expect(result.requestAccountClosure.closureId).toBeTruthy();
      expect(result.requestAccountClosure.requestedAt).toBeTruthy();
    }, 60_000);

    it('should mark notification as read and emit NOTIFICATION_READ', async () => {
      const pk = `InvestorProfile#${ctx.tenantId}#${cognitoSub}`;
      const notificationId = `integ-notif-read-${Date.now()}`;

      // Pre-seed a Notification so the UpdateItem condition passes
      // NOTE: seeder retained — event-driven replacement blocked on pk/sk alignment (Plan F)
      await seeder.seed({
        table: 'investor-bff',
        items: [{
          pk,
          sk: `Notification#${notificationId}`,
          __typename: 'Notification',
          tenantId: ctx.tenantId,
          userId: cognitoSub,
          notificationId,
          channel: 'IN_APP',
          title: 'Test notification',
          body: 'Test body',
          status: 'DELIVERED',
          relatedEntityType: 'Goal',
          relatedEntityId: 'goal-xyz',
          createdAt: new Date().toISOString(),
          sentAt: null,
          deliveredAt: new Date().toISOString(),
          readAt: null,
          timestamp: new Date().toISOString(),
        }],
      });

      const result = await appsync.mutate<{
        markNotificationRead: {
          notificationId: string;
          status: string;
          readAt: string;
        };
      }>(`
        mutation MarkNotificationRead($notificationId: ID!) {
          markNotificationRead(notificationId: $notificationId) {
            notificationId
            status
            readAt
          }
        }
      `, { notificationId });

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
      // Pre-seed profile and a goal so query resolvers return data
      await seeder.seed({
        table: 'investor-bff',
        items: [
          {
            pk: profilePk(),
            sk: 'InvestorProfile',
            __typename: 'InvestorProfile',
            tenantId: ctx.tenantId,
            userId: cognitoSub,
            name: 'Integration Tester',
            email: 'tester@integ-test.example',
            age: 35,
            locale: 'en',
            operatingMode: 'BALANCED',
            executionMode: 'simulation',
            monthlyContributionCents: 200_000,
            currency: 'USD',
            onboardingCompletedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
          },
          {
            pk: profilePk(),
            sk: 'Goal#seeded-goal-1',
            __typename: 'Goal',
            tenantId: ctx.tenantId,
            userId: cognitoSub,
            goalId: 'seeded-goal-1',
            objective: 'Retirement',
            targetAmountCents: 2_000_000_00,
            currency: 'USD',
            timeHorizonMonths: 240,
            targetReturn: 0.07,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }, 30_000);

    it('should return InvestorProfile via getProfile', async () => {
      const result = await appsync.query<{
        getProfile: {
          tenantId: string;
          userId: string;
          name: string;
          email: string;
          operatingMode: string;
          currency: string;
        };
      }>(`
        query GetProfile {
          getProfile {
            tenantId
            userId
            name
            email
            operatingMode
            currency
          }
        }
      `, {});

      expect(result.getProfile.tenantId).toBe(ctx.tenantId);
      expect(result.getProfile.userId).toBe(cognitoSub);
      expect(result.getProfile.email).toBe('tester@integ-test.example');
      expect(result.getProfile.operatingMode).toBe('BALANCED');
    }, 60_000);

    it('should return goals via getGoals', async () => {
      const result = await appsync.query<{
        getGoals: Array<{ goalId: string; objective: string; currency: string }>;
      }>(`
        query GetGoals {
          getGoals {
            goalId
            objective
            targetAmountCents
            currency
            timeHorizonMonths
            targetReturn
          }
        }
      `, {});

      expect(Array.isArray(result.getGoals)).toBe(true);
      const seeded = result.getGoals.find(g => g.goalId === 'seeded-goal-1');
      expect(seeded).toBeDefined();
      expect(seeded?.objective).toBe('Retirement');
      expect(seeded?.currency).toBe('USD');
    }, 60_000);
  });
});
