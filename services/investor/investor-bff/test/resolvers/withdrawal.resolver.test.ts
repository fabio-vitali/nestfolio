jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getUUID: () => 'test-uuid',
  getTime: () => '2026-01-01T00:00:00.000Z',
  NotRetryableError: class NotRetryableError extends Error { constructor(m: string) { super(m); } },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: () => (_name: string, fn: Function) => fn,
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  ConditionalCheckFailedException: class ConditionalCheckFailedException extends Error {
    readonly name = 'ConditionalCheckFailedException';
    constructor() { super('The conditional request failed'); }
  },
}));

import { requestWithdrawal } from '../../src/resolvers/withdrawal.resolver';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';

describe('requestWithdrawal', () => {
  const mockWithdrawCashConditional = jest.fn().mockResolvedValue(undefined);
  const mockPersistWithdrawal = jest.fn().mockResolvedValue({
    withdrawalId: 'test-uuid', amountCents: 50000, currency: 'USD', status: 'PENDING', requestedAt: '2026-01-01T00:00:00.000Z',
  });
  const mockPublish = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { withdrawCashConditional: mockWithdrawCashConditional, persistWithdrawal: mockPersistWithdrawal } as any;
  const mockBus = { publish: mockPublish } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should call withdrawCashConditional before persistWithdrawal', async () => {
    const callOrder: string[] = [];
    mockWithdrawCashConditional.mockImplementation(async () => { callOrder.push('withdraw'); });
    mockPersistWithdrawal.mockImplementation(async () => { callOrder.push('persist'); return { status: 'PENDING' }; });

    await requestWithdrawal(mockRepository, mockBus, 'tenant-1', 'user-1', { amountCents: 50000, currency: 'USD' });

    expect(callOrder).toEqual(['withdraw', 'persist']);
    expect(mockWithdrawCashConditional).toHaveBeenCalledWith('tenant-1', 'user-1', 50000);
  });

  it('should persist withdrawal and emit event on success', async () => {
    const result = await requestWithdrawal(mockRepository, mockBus, 'tenant-1', 'user-1', { amountCents: 50000, currency: 'USD' });

    expect(mockWithdrawCashConditional).toHaveBeenCalledWith('tenant-1', 'user-1', 50000);
    expect(mockPersistWithdrawal).toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'WITHDRAWAL_REQUESTED',
      subject: expect.objectContaining({
        withdrawalId: 'test-uuid',
        tenantId: 'tenant-1',
        userId: 'user-1',
        amountCents: 50000,
      }),
      context: { tenantId: 'tenant-1' },
    }));
    expect(result.status).toBe('PENDING');
  });

  it('should reject withdrawal when ConditionalCheckFailedException (insufficient funds)', async () => {
    mockWithdrawCashConditional.mockRejectedValueOnce(new (ConditionalCheckFailedException as any)());

    await expect(
      requestWithdrawal(mockRepository, mockBus, 'tenant-1', 'user-1', { amountCents: 50000, currency: 'USD' })
    ).rejects.toThrow(/Insufficient funds/);

    expect(mockPersistWithdrawal).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it('should propagate repository errors', async () => {
    mockPersistWithdrawal.mockRejectedValueOnce(new Error('DDB failure'));
    await expect(requestWithdrawal(mockRepository, mockBus, 't1', 'u1', { amountCents: 100, currency: 'USD' })).rejects.toThrow('DDB failure');
  });

  it('should propagate non-conditional DDB errors from withdrawCashConditional', async () => {
    mockWithdrawCashConditional.mockRejectedValueOnce(new Error('Throttled'));
    await expect(
      requestWithdrawal(mockRepository, mockBus, 'tenant-1', 'user-1', { amountCents: 50000, currency: 'USD' })
    ).rejects.toThrow('Throttled');
  });
});
