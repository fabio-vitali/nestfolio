import { project } from '@nestfolio/event-processor';
import type { UnitOfWork, BusEvent } from '@nestfolio/event-processor';
import { investorSnapshot } from '../../../src/transforms/investor-snapshot';

type TestUow = UnitOfWork<BusEvent<Record<string, unknown>>>;

describe('investorSnapshot transform', () => {
  const makeUow = (eventType: string, subject: Record<string, unknown> = {}): TestUow => ({
    event: {
      id: 'e1',
      type: eventType,
      timestamp: '2026-01-01T00:00:00.000Z',
      subject,
      context: { tenantId: 't1', userId: 'u1', region: 'us-east-1' },
    },
    payload: {},
    record: {},
  }) as unknown as TestUow;

  const compositePayload = (overrides: Record<string, unknown> = {}) => ({
    tenantId: 't1',
    userId: 'u1',
    operatingMode: 'BALANCED',
    goal: { objective: 'income' },
    riskProfile: { score: 5 },
    mandate: {
      mandateId: 'm-1',
      level: 'DISCRETIONARY',
    },
    ...overrides,
  });

  it('INVESTOR_PROFILE_CREATED → projects composite fields + onboardedAt', () => {
    const intent = investorSnapshot(makeUow('INVESTOR_PROFILE_CREATED', compositePayload()));
    expect(intent).toEqual(
      project(
        'InvestorSnapshot',
        {
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
          goalType: 'income',
          riskLevel: '5',
          operatingMode: 'BALANCED',
          onboardedAt: '2026-01-01T00:00:00.000Z',
        },
        { pk: 'T#t1', sk: 'InvestorSnapshot' },
      ),
    );
  });

  it('INVESTOR_PROFILE_UPDATED → projects composite fields without onboardedAt', () => {
    const intent = investorSnapshot(
      makeUow(
        'INVESTOR_PROFILE_UPDATED',
        compositePayload({
          goal: { objective: 'growth' },
          riskProfile: { score: 7 },
          operatingMode: 'AGGRESSIVE',
        }),
      ),
    );
    expect(intent).toEqual(
      project(
        'InvestorSnapshot',
        {
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
          goalType: 'growth',
          riskLevel: '7',
          operatingMode: 'AGGRESSIVE',
        },
        { pk: 'T#t1', sk: 'InvestorSnapshot' },
      ),
    );
  });

  it('omits goalType when goal.objective is missing', () => {
    const intent = investorSnapshot(
      makeUow('INVESTOR_PROFILE_UPDATED', compositePayload({ goal: {} })),
    );
    expect(intent).toEqual(
      project(
        'InvestorSnapshot',
        {
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
          riskLevel: '5',
          operatingMode: 'BALANCED',
        },
        { pk: 'T#t1', sk: 'InvestorSnapshot' },
      ),
    );
  });

  it('omits riskLevel when riskProfile is absent', () => {
    const intent = investorSnapshot(
      makeUow('INVESTOR_PROFILE_UPDATED', compositePayload({ riskProfile: undefined })),
    );
    expect(intent).toEqual(
      project(
        'InvestorSnapshot',
        {
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
          goalType: 'income',
          operatingMode: 'BALANCED',
        },
        { pk: 'T#t1', sk: 'InvestorSnapshot' },
      ),
    );
  });

  it('omits operatingMode when payload.operatingMode is undefined', () => {
    const intent = investorSnapshot(
      makeUow(
        'INVESTOR_PROFILE_UPDATED',
        compositePayload({ operatingMode: undefined }),
      ),
    );
    expect(intent).toEqual(
      project(
        'InvestorSnapshot',
        {
          tenantId: 't1',
          userId: 'u1',
          region: 'us-east-1',
          goalType: 'income',
          riskLevel: '5',
        },
        { pk: 'T#t1', sk: 'InvestorSnapshot' },
      ),
    );
  });
});
