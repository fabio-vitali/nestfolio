jest.mock('@nestfolio/platform-core', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  getUUID: () => 'test-uuid',
  getTime: () => '2026-01-01T00:00:00.000Z',
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: () => (_name: string, fn: Function) => fn,
}));

import { initiateDeposit } from './deposit.resolver';

describe('initiateDeposit', () => {
  const mockPersistDeposit = jest.fn().mockResolvedValue({
    depositId: 'test-uuid', amountCents: 50000, currency: 'EUR', status: 'PENDING', initiatedAt: '2026-01-01T00:00:00.000Z',
  });
  const mockPublish = jest.fn().mockResolvedValue(undefined);
  const mockRepository = { persistDeposit: mockPersistDeposit } as any;
  const mockBus = { publish: mockPublish } as any;

  beforeEach(() => jest.clearAllMocks());

  it('should persist deposit and emit event', async () => {
    const result = await initiateDeposit(mockRepository, mockBus, 'tenant-1', 'user-1', { amountCents: 50000, currency: 'EUR' });

    expect(mockPersistDeposit).toHaveBeenCalledWith('tenant-1', 'user-1', expect.objectContaining({
      depositId: 'test-uuid', amountCents: 50000, currency: 'EUR', status: 'PENDING',
    }));
    expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({
      type: 'DEPOSIT_INITIATED',
      subject: expect.objectContaining({
        depositId: 'test-uuid',
        tenantId: 'tenant-1',
        userId: 'user-1',
        amountCents: 50000,
        currency: 'EUR',
      }),
      context: { tenantId: 'tenant-1' },
    }));
    expect(result.status).toBe('PENDING');
  });

  it('should propagate repository errors', async () => {
    mockPersistDeposit.mockRejectedValueOnce(new Error('DDB failure'));
    await expect(initiateDeposit(mockRepository, mockBus, 't1', 'u1', { amountCents: 100, currency: 'USD' })).rejects.toThrow('DDB failure');
  });
});
