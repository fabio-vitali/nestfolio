import { projectVersioned } from '@nestfolio/event-processor';
import { investorSnapshot } from '../../../src/transforms/investor-snapshot';

const makeUow = (over: Record<string, unknown> = {}, type = 'INVESTOR_PROFILE_UPDATED') => ({
  event: {
    id: 'e1',
    type,
    timestamp: '2026-02-02T00:00:00.000Z',
    subject: {
      tenantId: 't1',
      userId: 'u1',
      operatingMode: 'BALANCED',
      goal: { objective: 'RETIREMENT' },
      riskProfile: { score: 7 },
      onboardingCompletedAt: '2026-01-01T00:00:00.000Z',
      __version: 5,
      ...over,
    },
    context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
  },
  payload: {},
  record: {},
});

describe('investorSnapshot transform', () => {
  it('returns a projectVersioned InvestorSnapshot intent versioned on payload __version', () => {
    expect(investorSnapshot(makeUow() as Parameters<typeof investorSnapshot>[0])).toEqual(
      projectVersioned('InvestorSnapshot', {
        tenantId: 't1',
        userId: 'u1',
        region: 'us-east-1',
        goalType: 'RETIREMENT',
        riskLevel: '7',
        operatingMode: 'BALANCED',
        onboardedAt: '2026-01-01T00:00:00.000Z',
      }, {
        version: 5,
        overrides: { pk: 'T#t1', sk: 'InvestorSnapshot' },
      }),
    );
  });

  it('reads onboardedAt from the stable payload field on UPDATED events too (not event.timestamp)', () => {
    const intent = investorSnapshot(
      makeUow({}, 'INVESTOR_PROFILE_UPDATED') as Parameters<typeof investorSnapshot>[0],
    ) as { fields: Record<string, unknown> };
    expect(intent.fields.onboardedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns undefined when the producer has not stamped a __version', () => {
    expect(
      investorSnapshot(makeUow({ __version: undefined }) as Parameters<typeof investorSnapshot>[0]),
    ).toBeUndefined();
  });
});
