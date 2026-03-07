import { PostAuthenticationTriggerEvent, Context } from 'aws-lambda';

const mockSendEB = jest.fn().mockResolvedValue({});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({ send: mockSendEB })),
  PutEventsCommand: jest.fn().mockImplementation((input) => ({ input })),
}));

jest.mock('crypto', () => ({
  randomUUID: jest.fn().mockReturnValue('event-uuid-1'),
}));

const buildEvent = (overrides: Partial<PostAuthenticationTriggerEvent> = {}): PostAuthenticationTriggerEvent => ({
  version: '1',
  region: 'us-east-1',
  userPoolId: 'us-east-1_TestPool',
  userName: 'test-user',
  callerContext: { awsSdkVersion: '1', clientId: 'client-123' },
  triggerSource: 'PostAuthentication_Authentication',
  request: {
    userAttributes: {
      sub: 'user-sub-123',
      'custom:tenant_id': 'tenant-abc-123',
    },
    newDeviceUsed: false,
  },
  response: {},
  ...overrides,
});

describe('post-authentication handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV, BUS_NAME: 'dev-investor-event-bus', SERVICE_NAME: 'investor-web' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('should publish USER_AUTHENTICATED event when tenant_id is present', async () => {
    const event = buildEvent();

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./post-authentication');
      await handler(event, {} as Context);
    });

    expect(mockSendEB).toHaveBeenCalledTimes(1);
    const ebCall = mockSendEB.mock.calls[0][0];
    expect(ebCall.input.Entries[0]).toMatchObject({
      EventBusName: 'dev-investor-event-bus',
      Source: 'dev-investor-event-bus@investor-web',
      DetailType: 'USER_AUTHENTICATED',
    });

    const detail = JSON.parse(ebCall.input.Entries[0].Detail);
    expect(detail.type).toBe('USER_AUTHENTICATED');
    expect(detail.subject).toEqual({
      userId: 'user-sub-123',
      tenantId: 'tenant-abc-123',
    });
    expect(detail.context).toEqual({ tenantId: 'tenant-abc-123' });
  });

  it('should not publish event when tenant_id is missing', async () => {
    const event = buildEvent({
      request: {
        userAttributes: {
          sub: 'user-sub-123',
        },
        newDeviceUsed: false,
      },
    });

    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./post-authentication');
      await handler(event, {} as Context);
    });

    expect(mockSendEB).not.toHaveBeenCalled();
  });

  it('should return the original Cognito event', async () => {
    const event = buildEvent();

    let result: PostAuthenticationTriggerEvent | undefined;
    await jest.isolateModulesAsync(async () => {
      const { handler } = require('./post-authentication');
      result = await handler(event, {} as Context);
    });

    expect(result).toBe(event);
  });
});
