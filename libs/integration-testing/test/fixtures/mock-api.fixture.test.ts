import { IAMClient } from '@aws-sdk/client-iam';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { MockApiFixture } from '../../src/fixtures/mock-api.fixture';

// Mock SDK clients — no real AWS credentials needed for unit tests
jest.mock('@aws-sdk/client-iam');
jest.mock('@aws-sdk/client-lambda');

const mockIamSend = jest.fn();
const mockIamDestroy = jest.fn();
(IAMClient as jest.Mock).mockImplementation(() => ({ send: mockIamSend, destroy: mockIamDestroy }));

const mockLambdaSend = jest.fn();
const mockLambdaDestroy = jest.fn();
(LambdaClient as jest.Mock).mockImplementation(() => ({ send: mockLambdaSend, destroy: mockLambdaDestroy }));

const mockCtx = { region: 'us-east-1', cleanup: { register: jest.fn() } } as any;

describe('MockApiFixture', () => {
  beforeEach(() => {
    mockIamSend.mockReset();
    mockIamDestroy.mockReset();
    mockLambdaSend.mockReset();
    mockLambdaDestroy.mockReset();
  });

  it('destroys iam and lambda clients on teardown', async () => {
    const fixture = new MockApiFixture(mockCtx);

    await fixture.teardown();

    expect(mockIamDestroy).toHaveBeenCalledTimes(1);
    expect(mockLambdaDestroy).toHaveBeenCalledTimes(1);
  });
});
