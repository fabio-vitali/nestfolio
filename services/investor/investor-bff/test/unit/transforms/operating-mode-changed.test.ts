import { operatingModeChanged } from '../../../src/transforms/operating-mode-changed';

describe('operatingModeChanged transform', () => {
  it('emits a single project intent on the composite InvestorProfile row', () => {
    const intent = operatingModeChanged(
      { subject: { tenantId: 't1', userId: 'u1', mode: 'AGGRESSIVE' } } as any,
      { tenantId: 't1', userId: 'u1', region: 'us-east-1', eventId: 'e1', eventType: 'OPERATING_MODE_CHANGED', timestamp: 'now' } as any,
    );
    expect(intent).toMatchObject({
      _tag: 'project',
      typename: 'InvestorProfile',
      overrides: { pk: 'InvestorProfile#t1#u1', sk: 'InvestorProfile' },
      fields: expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
    });
  });
});
