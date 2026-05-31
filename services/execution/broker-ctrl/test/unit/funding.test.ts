import { STATUS_ORDINAL, fundingCarrier } from '../../src/domain/funding';

describe('funding domain', () => {
  it('maps status to monotonic ordinal', () => {
    expect(STATUS_ORDINAL.requested).toBe(1);
    expect(STATUS_ORDINAL.detected).toBe(2);
    expect(STATUS_ORDINAL.settled).toBe(3);
    expect(STATUS_ORDINAL.failed).toBe(3);
  });

  it('builds a DEPOSIT_SETTLED carrier record intent with full snapshot + __version', () => {
    const intent = fundingCarrier({
      eventName: 'DEPOSIT_SETTLED',
      direction: 'DEPOSIT',
      status: 'settled',
      transferId: 'dep-1',
      tenantId: 't-1',
      userId: 'u-1',
      region: 'us-east-1',
      amountCents: 100000,
      currency: 'USD',
      executionMode: 'simulation',
      initiatedAt: '2026-01-01T00:00:00.000Z',
      detectedAt: '2026-01-02T00:00:00.000Z',
      settledAt: '2026-01-03T00:00:00.000Z',
      timestamp: '2026-01-03T00:00:00.000Z',
    });
    expect(intent).toMatchObject({
      _tag: 'record',
      typename: 'FundingEvent',
      fields: expect.objectContaining({
        __typename: 'FundingEvent',
        sk: 'DEPOSIT_SETTLED',
        direction: 'DEPOSIT',
        status: 'settled',
        transferId: 'dep-1',
        amountCents: 100000,
        settledAt: '2026-01-03T00:00:00.000Z',
        __version: 3,
      }),
      overrides: { pk: 'Funding#t-1#dep-1', sk: 'DEPOSIT_SETTLED' },
    });
  });
});
