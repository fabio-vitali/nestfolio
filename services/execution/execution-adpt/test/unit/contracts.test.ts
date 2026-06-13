import { AlpacaTransferRequestSchema } from '../../src/domain/contracts';

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
});
