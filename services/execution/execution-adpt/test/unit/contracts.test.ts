import { AlpacaTransferRequestSchema, AlpacaTransferResultSchema } from '../../src/domain/contracts';

describe('execution-adpt funding boundary contracts', () => {
  it('AlpacaTransferRequestSchema parses a deposit request (dry, identity in ctx)', () => {
    const parsed = AlpacaTransferRequestSchema.parse({
      transferId: 'dep-1', amountCents: 100000, currency: 'USD',
      direction: 'INCOMING', relationshipId: '',
    });
    expect(parsed.transferId).toBe('dep-1');
    expect(parsed.direction).toBe('INCOMING');
  });

  it('AlpacaTransferRequestSchema rejects a missing transferId', () => {
    expect(() => AlpacaTransferRequestSchema.parse({
      amountCents: 100000, currency: 'USD', direction: 'OUTGOING', relationshipId: '',
    })).toThrow();
  });

  it('AlpacaTransferRequestSchema rejects an invalid direction', () => {
    expect(() => AlpacaTransferRequestSchema.parse({
      transferId: 'wd-1', amountCents: 5000, currency: 'USD', direction: 'IN', relationshipId: '',
    })).toThrow();
  });

  it('AlpacaTransferResultSchema parses an INITIATED transfer subject (dry)', () => {
    expect(AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'dep-1', alpacaTransferId: 'at1', direction: 'INCOMING',
      amount: 500, status: 'INITIATED', timestamp: '2026-06-10T00:00:00.000Z',
    }).direction).toBe('INCOMING');
  });

  it('AlpacaTransferResultSchema parses without timestamp (event-listener emission path)', () => {
    const parsed = AlpacaTransferResultSchema.parse({
      nestfolioTransferId: 'wd-1', alpacaTransferId: 'at1', direction: 'OUTGOING',
      amount: 250, status: 'COMPLETED',
    });
    expect(parsed.timestamp).toBeUndefined();
    expect(parsed.status).toBe('COMPLETED');
  });
});
