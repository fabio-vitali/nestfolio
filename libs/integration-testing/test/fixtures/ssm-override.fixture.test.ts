import { SSMClient, PutParameterCommand, DeleteParameterCommand } from '@aws-sdk/client-ssm';
import { SsmOverrideFixture } from '../../src/fixtures/ssm-override.fixture';

// Mock the SSM client — no real AWS credentials needed for unit tests
jest.mock('@aws-sdk/client-ssm');
const mockSend = jest.fn();
const mockDestroy = jest.fn();
(SSMClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));

const PARAM = '/test/ssm-override-fixture/baseUrl';
const BACKUP = `${PARAM}.backup`;
const REAL_VALUE = 'https://real-api.example.com';
const MOCK_VALUE = 'https://mock-lambda.lambda-url.us-east-1.on.aws';
const POISONED_VALUE = 'https://stale-mock.lambda-url.us-east-1.on.aws';

const mockCleanup = { register: jest.fn() };
const mockCtx = { region: 'us-east-1', cleanup: mockCleanup } as any;

describe('SsmOverrideFixture', () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockDestroy.mockReset();
    mockCleanup.register.mockReset();
  });

  it('saves restoreTo (not the live read) to .backup on first override', async () => {
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    // paramExists(.backup) → not found
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → matches restoreTo
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(.backup) → ok
    mockSend.mockResolvedValueOnce({});
    // PutParameter(main with mock) → ok
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      restoreTo: REAL_VALUE,
      waitMs: 0,
    });

    // Assert the value written to .backup is restoreTo, NOT what was read from SSM
    const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
    expect(putCalls[0][0]).toMatchObject({ Name: BACKUP, Value: REAL_VALUE });
    expect(putCalls[1][0]).toMatchObject({ Name: PARAM, Value: MOCK_VALUE });

    expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));
  });

  it('refuses to override and throws when current value differs from restoreTo on first run', async () => {
    // paramExists(.backup) → not found (no crash recovery, this is a real first run)
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    // GetParameter(main) → poisoned mock URL from prior failed test
    mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });

    const fixture = new SsmOverrideFixture(mockCtx);

    await expect(fixture.override({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      restoreTo: REAL_VALUE,
      waitMs: 0,
    })).rejects.toThrow(/refusing to back up.*expected restoreTo='https:\/\/real-api.*current value is 'https:\/\/stale-mock/);

    // Did NOT write to .backup or main param
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockCleanup.register).not.toHaveBeenCalled();
  });

  it('skips backup save on crash-recovery (.backup already exists)', async () => {
    // paramExists(.backup) → found (previous crash left it)
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    // PutParameter(main with mock) → ok (skips reading current + writing .backup)
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      restoreTo: REAL_VALUE,
      waitMs: 0,
    });

    // Only 2 calls: paramExists + PutParam(main). No GetParam(main), no PutParam(.backup).
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it('restore puts restoreTo back (from memory, not from .backup)', async () => {
    // First setup: do an override to populate restoreTo in memory
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      restoreTo: REAL_VALUE,
      waitMs: 0,
    });

    // Now restore — should NOT read .backup. Just PutParam(restoreTo) + DeleteParam(.backup).
    mockSend.mockReset();
    (PutParameterCommand as unknown as jest.Mock).mockClear();
    (DeleteParameterCommand as unknown as jest.Mock).mockClear();
    mockSend.mockResolvedValueOnce({}); // PutParam(main, REAL_VALUE)
    mockSend.mockResolvedValueOnce({}); // DeleteParam(.backup)

    await fixture.restore();

    expect(mockSend).toHaveBeenCalledTimes(2);
    const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
    expect(putCalls[0][0]).toMatchObject({ Name: PARAM, Value: REAL_VALUE });
    const deleteCalls = (DeleteParameterCommand as unknown as jest.Mock).mock.calls;
    expect(deleteCalls[0][0]).toMatchObject({ Name: BACKUP });
  });

  it('destroys the ssm client on restore, even when override was never called', async () => {
    const fixture = new SsmOverrideFixture(mockCtx);

    // restore() on a fixture that never called override() hits the early-return
    // path. destroy() must still run so Jest's connection pool clears.
    await fixture.restore();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the ssm client after a successful override+restore', async () => {
    // Happy-path override (same setup as the `restore puts restoreTo back` test)
    mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
    mockSend.mockResolvedValueOnce({ Parameter: { Value: REAL_VALUE } });
    mockSend.mockResolvedValueOnce({});
    mockSend.mockResolvedValueOnce({});

    const fixture = new SsmOverrideFixture(mockCtx);
    await fixture.override({
      paramName: PARAM,
      testValue: MOCK_VALUE,
      restoreTo: REAL_VALUE,
      waitMs: 0,
    });

    mockSend.mockResolvedValueOnce({}); // PutParam(restore)
    mockSend.mockResolvedValueOnce({}); // DeleteParam(.backup)
    await fixture.restore();

    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });

  describe('overrideAndDeriveRestore', () => {
    it('derives restoreTo from canonical on first run (no .backup)', async () => {
      (PutParameterCommand as unknown as jest.Mock).mockClear();
      // paramExists(.backup) → not found
      mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
      // GetParameter(main) → canonical ARN
      const ARN = 'arn:aws:bedrock-agentcore-runtime:us-east-1:111:runtime/foo';
      mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
      // PutParameter(.backup) → ok
      mockSend.mockResolvedValueOnce({});
      // PutParameter(main with mock) → ok
      mockSend.mockResolvedValueOnce({});

      const fixture = new SsmOverrideFixture(mockCtx);
      await fixture.overrideAndDeriveRestore({
        paramName: PARAM,
        testValue: MOCK_VALUE,
        expectedRestorePrefix: 'arn:',
        waitMs: 0,
      });

      const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
      expect(putCalls[0][0]).toMatchObject({ Name: BACKUP, Value: ARN });
      expect(putCalls[1][0]).toMatchObject({ Name: PARAM, Value: MOCK_VALUE });
      expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));
    });

    it('recovers from a prior crash via .backup, repairing canonical and deriving restoreTo from .backup', async () => {
      (PutParameterCommand as unknown as jest.Mock).mockClear();
      (DeleteParameterCommand as unknown as jest.Mock).mockClear();
      const ARN = 'arn:aws:bedrock-agentcore-runtime:us-east-1:111:runtime/foo';
      // paramExists(.backup) → found
      mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
      // GetParameter(.backup) → valid ARN
      mockSend.mockResolvedValueOnce({ Parameter: { Value: ARN } });
      // PutParameter(main, ARN) — repair canonical from .backup
      mockSend.mockResolvedValueOnce({});
      // PutParameter(main, MOCK_VALUE) — testValue write
      mockSend.mockResolvedValueOnce({});

      const fixture = new SsmOverrideFixture(mockCtx);
      await fixture.overrideAndDeriveRestore({
        paramName: PARAM,
        testValue: MOCK_VALUE,
        expectedRestorePrefix: 'arn:',
        waitMs: 0,
      });

      const putCalls = (PutParameterCommand as unknown as jest.Mock).mock.calls;
      // 1st PutParam: repair canonical from .backup (ARN)
      expect(putCalls[0][0]).toMatchObject({ Name: PARAM, Value: ARN });
      // 2nd PutParam: write testValue
      expect(putCalls[1][0]).toMatchObject({ Name: PARAM, Value: MOCK_VALUE });
      // No .backup write (existing .backup left in place)
      expect(putCalls.filter((c: any[]) => c[0].Name === BACKUP)).toHaveLength(0);
      // No DeleteParameter calls during override (.backup is deleted only on restore)
      expect((DeleteParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);

      expect(mockCleanup.register).toHaveBeenCalledWith('SsmOverrideFixture', expect.any(Function));
    });

    it('refuses to proceed when both .backup and canonical are corrupt', async () => {
      (PutParameterCommand as unknown as jest.Mock).mockClear();
      (DeleteParameterCommand as unknown as jest.Mock).mockClear();
      // paramExists(.backup) → found
      mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });
      // GetParameter(.backup) → poisoned mock URL (not 'arn:'-prefixed)
      mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });
      // GetParameter(main) → also poisoned (for error-message enrichment)
      mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });

      const fixture = new SsmOverrideFixture(mockCtx);

      await expect(fixture.overrideAndDeriveRestore({
        paramName: PARAM,
        testValue: MOCK_VALUE,
        expectedRestorePrefix: 'arn:',
        waitMs: 0,
      })).rejects.toThrow(/refusing to recover.*\.backup value 'https:\/\/stale-mock.*live canonical is 'https:\/\/stale-mock/);

      // No writes attempted, no cleanup registered
      expect((PutParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
      expect((DeleteParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
      expect(mockCleanup.register).not.toHaveBeenCalled();
    });

    it('throws Re-deploy error when no .backup exists and canonical fails prefix check', async () => {
      (PutParameterCommand as unknown as jest.Mock).mockClear();
      // paramExists(.backup) → not found
      mockSend.mockRejectedValueOnce(new Error('ParameterNotFound'));
      // GetParameter(main) → poisoned mock URL
      mockSend.mockResolvedValueOnce({ Parameter: { Value: POISONED_VALUE } });

      const fixture = new SsmOverrideFixture(mockCtx);

      await expect(fixture.overrideAndDeriveRestore({
        paramName: PARAM,
        testValue: MOCK_VALUE,
        expectedRestorePrefix: 'arn:',
        waitMs: 0,
      })).rejects.toThrow(/expected canonical SSM value.*to start with 'arn:'.*Re-deploy the relevant stack/);

      expect((PutParameterCommand as unknown as jest.Mock).mock.calls).toHaveLength(0);
      expect(mockCleanup.register).not.toHaveBeenCalled();
    });
  });
});
