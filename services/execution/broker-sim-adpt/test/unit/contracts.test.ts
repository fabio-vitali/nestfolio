import {
  SimDepositCompletedSchema,
  SimWithdrawalCompletedSchema,
  VirtualTradeSchema,
  VirtualCashBalanceSchema,
  VirtualPositionSchema,
  VirtualSnapshotSchema,
} from '../../src/domain/contracts';

describe('broker-sim-adpt contracts', () => {
  it('SimDepositCompletedSchema still parses (regression)', () => {
    expect(SimDepositCompletedSchema.parse({
      depositId: 'd1', amountCents: 1000, currency: 'USD',
      sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    }).depositId).toBe('d1');
  });

  it('SimWithdrawalCompletedSchema parses the WithdrawalCompleted subject (dry)', () => {
    const parsed = SimWithdrawalCompletedSchema.parse({
      tenantId: 't', userId: 'u', withdrawalId: 'w1', amount: 250,
      sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.amount).toBe(250);
  });

  it('SimWithdrawalCompletedSchema rejects a non-positive amount', () => {
    expect(() => SimWithdrawalCompletedSchema.parse({
      withdrawalId: 'w1', amount: -100,
      sourceEventId: 'e1', timestamp: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('VirtualTradeSchema parses a SIM_ORDER_FILLED trade subject (dry)', () => {
    const parsed = VirtualTradeSchema.parse({
      tenantId: 't', userId: 'u', region: 'us-east-1', pk: 'VirtualLedger#t#u', sk: 'Trade#x',
      tradeId: 'x', orderId: 'o1', symbol: 'VTI', side: 'BUY', quantity: 5,
      fillPrice: 200, totalValue: 1000, cashBefore: 5000, cashAfter: 4000,
      executedAt: '2026-06-10T00:00:00.000Z',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.symbol).toBe('VTI');
  });

  it('VirtualTradeSchema rejects an invalid side', () => {
    expect(() => VirtualTradeSchema.parse({
      tradeId: 'x', orderId: 'o1', symbol: 'VTI', side: 'HOLD', quantity: 5,
      fillPrice: 200, totalValue: 1000, cashBefore: 5000, cashAfter: 4000,
      executedAt: '2026-06-10T00:00:00.000Z',
    })).toThrow();
  });

  it('internal virtual-ledger rows parse (dry)', () => {
    expect(VirtualCashBalanceSchema.parse({ currency: 'USD', balance: 1000, version: 1, updatedAt: '2026' }).balance).toBe(1000);
    expect(VirtualPositionSchema.parse({ symbol: 'VTI', quantity: 5, averageCostBasis: 200, marketValue: 1000, updatedAt: '2026' }).symbol).toBe('VTI');
    expect(VirtualSnapshotSchema.parse({ date: '2026-06-10', cashBalance: 1000, positions: [], totalValue: 2000, createdAt: '2026' }).totalValue).toBe(2000);
  });
});
