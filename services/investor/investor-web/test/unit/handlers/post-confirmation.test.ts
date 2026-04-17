import { PostConfirmationTriggerEvent, Context } from 'aws-lambda';

const mockSendEB = jest.fn().mockResolvedValue({});
const mockSendCognito = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSendEB })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: mockSendCognito })),
  AdminUpdateUserAttributesCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn()
    .mockReturnValueOnce('tenant-uuid-1')
    .mockReturnValueOnce('event-uuid-1'),
}));

jest.mock('@nestfolio/event-processor', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,

}));
const buildEvent = (overrides: Partial<PostConfirmationTriggerEvent> = {}): PostConfirmationTriggerEvent => ({
  version: '1',
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool',
  userName: 'test-user',
  callerContext: { awsSdkVersion: '1', clientId: 'client-123' },
  triggerSource: 'PostConfirmation_ConfirmSignUp',
  request: {
    userAttributes: {
      sub: 'user-sub-123',
      email: 'test@example.com',
    },
  },
  response: {},
  ...overrides,
});

describe('post-confirmation handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, BUS_NAME: 'dev-investor-event-bus', SERVICE_NAME: 'investor-web' };
    // Reset the randomUUID mock for each test
    const crypto = require('crypto');
    (crypto.randomUUID as jest.Mock)
      .mockReturnValueOnce('tenant-uuid-1')
      .mockReturnValueOnce('event-uuid-1');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should generate a tenant_id and update Cognito user attributes', async () => {
    const event = buildEvent();

    // Re-require to pick up env vars
    jest.isolateModules(async () => {
      const { handler } = require('../../../src/handlers/post-confirmation');
      await handler(event, {} as Context);
    });

    // Give isolateModules time to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSendCognito).toHaveBeenCalledTimes(1);
    const cognitoCall = mockSendCognito.mock.calls[0][0];
    expect(cognitoCall.input).toEqual({
      UserPoolId: 'us-east-1_TestPool',
      Username: 'test-user',
      UserAttributes: [{ Name: 'custom:tenant_id', Value: 'tenant-uuid-1' }],
    });
  });

  it('should publish USER_REGISTERED event to EventBridge', async () => {
    const event = buildEvent();

    jest.isolateModules(async () => {
      const { handler } = require('../../../src/handlers/post-confirmation');
      await handler(event, {} as Context);
    });

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSendEB).toHaveBeenCalledTimes(1);
    const ebCall = mockSendEB.mock.calls[0][0];
    expect(ebCall.input.Entries[0]).toMatchObject({
      EventBusName: 'dev-investor-event-bus',
      Source: 'dev-investor-event-bus@investor-web',
      DetailType: 'USER_REGISTERED',
    });

    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.type).toBe('USER_REGISTERED');
    expect(detail.subject).toEqual({
      userId: 'user-sub-123',
      tenantId: 'tenant-uuid-1',
      email: 'test@example.com',
    });
    expect(detail.context).toEqual({ tenantId: 'tenant-uuid-1' });
  });

  it('should return the original Cognito event', async () => {
    const event = buildEvent();

    let result: PostConfirmationTriggerEvent | undefined;
    await jest.isolateModulesAsync(async () => {
      const { handler } = require('../../../src/handlers/post-confirmation');
      result = await handler(event, {} as Context);
    });

    expect(result).toBe(event);
  });
});
