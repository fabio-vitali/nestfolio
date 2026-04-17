jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  getTime: jest.fn().mockReturnValue('2026-01-15T00:00:00.000Z'),
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  withMethodLogging: jest.fn((_className: string) =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

import { TaxLotManager, type OpenLotParams, type CloseLotParams, type TaxLot } from '../../src/services/tax-lot-manager';
import { LedgerRepository } from '../../src/repositories/ledger.repository';

function makeLot(overrides: Partial<TaxLot> & Pick<TaxLot, 'pk' | 'sk' | 'lotId' | 'symbol' | 'quantity' | 'costBasisPerShare' | 'acquiredAt'>): TaxLot {
  return { __typename: 'TaxLot', tenantId: 't1', status: 'open', ...overrides };
}

describe('TaxLotManager', () => {
  let manager: TaxLotManager;
  let mockRepo: jest.Mocked<Pick<LedgerRepository,
    'putTaxLot' | 'getOpenLotsBySymbol' | 'closeTaxLot' | 'updateTaxLotQuantity' | 'putDisposition'
  >>;

  beforeEach(() => {
    mockRepo = {
      putTaxLot: jest.fn().mockResolvedValue(undefined),
      getOpenLotsBySymbol: jest.fn().mockResolvedValue([]),
      closeTaxLot: jest.fn().mockResolvedValue(undefined),
      updateTaxLotQuantity: jest.fn().mockResolvedValue(undefined),
      putDisposition: jest.fn().mockResolvedValue(undefined),
    };
    manager = new TaxLotManager(mockRepo as unknown as LedgerRepository);
  });

  it('openLot creates a TaxLot record', async () => {
    const params: OpenLotParams = {
      tenantId: 't1',
      orderId: 'ord-1',
      symbol: 'VTI',
      quantity: 50,
      costBasisPerShare: 250.00,
      acquiredAt: '2025-06-01T10:00:00.000Z',
    };

    await manager.openLot(params);

    expect(mockRepo.putTaxLot).toHaveBeenCalledWith({
      pk: 'TaxLot#t1#VTI',
      sk: 'Lot#2025-06-01T10:00:00.000Z#ord-1-VTI',
      __typename: 'TaxLot',
      tenantId: 't1',
      lotId: 'ord-1-VTI',
      symbol: 'VTI',
      quantity: 50,
      costBasisPerShare: 250.00,
      acquiredAt: '2025-06-01T10:00:00.000Z',
      status: 'open',
    });
  });

  it('closeLots FIFO — sells 80 shares, consumes oldest lots first', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01T00:00:00.000Z#lot-a',
        lotId: 'lot-a', symbol: 'VTI', quantity: 50, costBasisPerShare: 200, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-06-01T00:00:00.000Z#lot-b',
        lotId: 'lot-b', symbol: 'VTI', quantity: 50, costBasisPerShare: 220, acquiredAt: '2025-06-01T00:00:00.000Z',
      }),
    ]);

    const params: CloseLotParams = {
      tenantId: 't1', symbol: 'VTI', quantity: 80, salePrice: 260, soldAt: '2026-03-01T00:00:00.000Z', orderId: 'sell-1',
    };
    const dispositions = await manager.closeLots(params);

    expect(dispositions).toHaveLength(2);
    // First lot fully consumed (50 shares)
    expect(dispositions[0].lotId).toBe('lot-a');
    expect(dispositions[0].quantitySold).toBe(50);
    // Second lot partially consumed (30 shares)
    expect(dispositions[1].lotId).toBe('lot-b');
    expect(dispositions[1].quantitySold).toBe(30);
  });

  it('closeLots correctly calculates realizedGain (positive and negative)', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01#lot-gain',
        lotId: 'lot-gain', symbol: 'VTI', quantity: 10, costBasisPerShare: 100, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);

    // Sell at higher price → positive gain
    const gainDispositions = await manager.closeLots({
      tenantId: 't1', symbol: 'VTI', quantity: 10, salePrice: 150, soldAt: '2025-06-01T00:00:00.000Z', orderId: 'sell-gain',
    });
    expect(gainDispositions[0].realizedGain).toBe(500); // (150 - 100) * 10

    // Reset and test negative gain
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01#lot-loss',
        lotId: 'lot-loss', symbol: 'VTI', quantity: 10, costBasisPerShare: 200, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);

    const lossDispositions = await manager.closeLots({
      tenantId: 't1', symbol: 'VTI', quantity: 10, salePrice: 180, soldAt: '2025-06-01T00:00:00.000Z', orderId: 'sell-loss',
    });
    expect(lossDispositions[0].realizedGain).toBe(-200); // (180 - 200) * 10
  });

  it('closeLots determines holdingPeriod (short-term < 1 year, long-term >= 1 year)', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2024-01-01#lot-lt',
        lotId: 'lot-lt', symbol: 'VTI', quantity: 10, costBasisPerShare: 100, acquiredAt: '2024-01-01T00:00:00.000Z',
      }),
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-10-01#lot-st',
        lotId: 'lot-st', symbol: 'VTI', quantity: 10, costBasisPerShare: 110, acquiredAt: '2025-10-01T00:00:00.000Z',
      }),
    ]);

    const dispositions = await manager.closeLots({
      tenantId: 't1', symbol: 'VTI', quantity: 20, salePrice: 120, soldAt: '2026-01-15T00:00:00.000Z', orderId: 'sell-hp',
    });

    // First lot: acquired 2024-01-01, sold 2026-01-15 → long-term (>1 year)
    expect(dispositions[0].holdingPeriod).toBe('long-term');
    // Second lot: acquired 2025-10-01, sold 2026-01-15 → short-term (<1 year)
    expect(dispositions[1].holdingPeriod).toBe('short-term');
  });

  it('closeLots marks lots as closed when fully consumed', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01#lot-full',
        lotId: 'lot-full', symbol: 'VTI', quantity: 30, costBasisPerShare: 100, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);

    await manager.closeLots({
      tenantId: 't1', symbol: 'VTI', quantity: 30, salePrice: 120, soldAt: '2025-06-01T00:00:00.000Z', orderId: 'sell-full',
    });

    expect(mockRepo.closeTaxLot).toHaveBeenCalledWith('TaxLot#t1#VTI', 'Lot#2025-01-01#lot-full');
    expect(mockRepo.updateTaxLotQuantity).not.toHaveBeenCalled();
  });

  it('closeLots partial lot consumption updates remaining quantity', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01#lot-partial',
        lotId: 'lot-partial', symbol: 'VTI', quantity: 100, costBasisPerShare: 100, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);

    await manager.closeLots({
      tenantId: 't1', symbol: 'VTI', quantity: 40, salePrice: 120, soldAt: '2025-06-01T00:00:00.000Z', orderId: 'sell-partial',
    });

    expect(mockRepo.updateTaxLotQuantity).toHaveBeenCalledWith('TaxLot#t1#VTI', 'Lot#2025-01-01#lot-partial', 60);
    expect(mockRepo.closeTaxLot).not.toHaveBeenCalled();
  });

  it('getUnrealizedGains calculates unrealized gains', async () => {
    mockRepo.getOpenLotsBySymbol.mockResolvedValue([
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-01-01#lot-ug-1',
        lotId: 'lot-ug-1', symbol: 'VTI', quantity: 50, costBasisPerShare: 200, acquiredAt: '2025-01-01T00:00:00.000Z',
      }),
      makeLot({
        pk: 'TaxLot#t1#VTI', sk: 'Lot#2025-06-01#lot-ug-2',
        lotId: 'lot-ug-2', symbol: 'VTI', quantity: 30, costBasisPerShare: 220, acquiredAt: '2025-06-01T00:00:00.000Z',
      }),
    ]);

    const unrealized = await manager.getUnrealizedGains('t1', 'VTI', 260);

    // Lot 1: (260 - 200) * 50 = 3000
    // Lot 2: (260 - 220) * 30 = 1200
    // Total: 4200
    expect(unrealized).toBe(4200);
  });
});
