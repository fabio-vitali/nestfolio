import { SSMClient, GetParameterCommand, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { SsmOverrideFixture } from '../../src/fixtures/ssm-override.fixture';

// Mock the SSM client — no real AWS credentials needed for unit tests
jest.mock('@aws-sdk/client-ssm');
const mockSend = jest.fn();
(SSMClient as jest.Mock).mockImplementation(() => ({ send: mockSend }));

const PARAM = '/test/ssm-override-fixture/baseUrl';
const BACKUP = `${PARAM}.backup`;
const REAL_VALUE = 'https://real-api.example.com';
const MOCK_VALUE = 'https://mock-lambda.lambda-url.us-east-1.on.aws';

const mockCleanup = { register: jest.fn() };
const mockCtx = { region: 'us-east-1', cleanup: mockCleanup } as any;

describe('SsmOverrideFixture crash-safe backup', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockCleanup.register.mockReset();
  });

  it('should create .backup on first override and restore on cleanup', async () => {
    // paramExists(.backup) → not found
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → real value
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});
    // PutParameter(main with mock) → ok
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({ paramName: PARAM, testValue: MOCK_VALUE, waitMs: 0 });

    // Verify: checked .backup, read main, wrote .backup, wrote main with mock
    expect(mockSend).toHaveBeenCalledTimes(4);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(PutParameterCommand);
    expect(mockSend.mock.calls[3][0]).toBeInstanceOf(PutParameterCommand);
    expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));

    // Simulate cleanup (restore)
    mockSend.mockReset();
    // GetParameter(.backup) → real value
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(main with real value) → ok
    mockSend.mockResolvedValueOnce({});
    // DeleteParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});

    await fixture.restore();
    expect(mockSend).toHaveBeenCalledTimes(3);
    expect(mockSend.mock.calls[2][0]).toBeInstanceOf(DeleteParameterCommand);
  });

  it('should recover from crashed run (stale .backup exists)', async () => {
    // paramExists(.backup) → found (previous crash left it)
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(main with mock) → ok (skips writing .backup since it already exists)
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({ paramName: PARAM, testValue: MOCK_VALUE, waitMs: 0 });

    // Should NOT have read main or written .backup — it preserved the existing .backup
    expect(mockSend).toHaveBeenCalledTimes(2);

    // Restore — should put back the real value from .backup
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    await fixture.restore();
    expect(mockSend.mock.calls[1][0]).toBeInstanceOf(PutParameterCommand);
  });
});
