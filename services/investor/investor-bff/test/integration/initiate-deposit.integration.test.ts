import {
  createIntegrationContext,
  CognitoFixture,
  AppSyncClient,
  EventBusTrap,
  TableAssertions,
  type IntegrationContext,
} from '@nestfolio/integration-testing';

describe('investor-bff: initiateDeposit', () => {
  let ctx: IntegrationContext;
  let cognito: CognitoFixture;
  let appsync: AppSyncClient;
  let trap: EventBusTrap;
  let table: TableAssertions;
  let cognitoSub: string;

  beforeAll(async () => {
    ctx = await createIntegrationContext();
    cognito = new CognitoFixture(ctx);
    const tokens = await cognito.setup();
    appsync = new AppSyncClient(ctx, tokens, 'investor-bff');
    trap = new EventBusTrap(ctx);
    table = new TableAssertions(ctx);

    // Extract Cognito sub (used as userId in AppSync resolvers)
    const payload = JSON.parse(Buffer.from(tokens.idToken.split('.')[1], 'base64url').toString());
    cognitoSub = payload.sub;

    // Deploy trap BEFORE the mutation (captures DEPOSIT_INITIATED on InvestorBus)
    await trap.deploy({
      bus: 'investor',
      detailType: 'DEPOSIT_INITIATED',
    });
  }, 60_000);

  afterAll(async () => {
    await ctx.cleanup.runAll();
  }, 30_000);

  it('should create deposit record and emit DEPOSIT_INITIATED', async () => {
    // Act: authenticated GraphQL mutation
    const result = await appsync.mutate<{
      initiateDeposit: { depositId: string; status: string };
    }>(`
      mutation InitiateDeposit($input: DepositInput!) {
        initiateDeposit(input: $input) { depositId status }
      }
    `, {
      input: { amountCents: 100_000, currency: 'USD' },
    });

    expect(result.initiateDeposit.status).toBe('INITIATED');
    const depositId = result.initiateDeposit.depositId;

    // Assert: DDB state
    const item = await table.waitForItem({
      table: 'investor-bff',
      pk: `InvestorProfile#${ctx.tenantId}#${cognitoSub}`,
      sk: `Deposit#${depositId}`,
    });
    expect(item['amountCents']).toBe(100_000);

    // Assert: CDC event on EventBridge
    const event = await trap.waitForEvent();
    expect(event.detailType).toBe('DEPOSIT_INITIATED');
    expect(event.detail.context.tenantId).toBe(ctx.tenantId);
  }, 60_000);
});
