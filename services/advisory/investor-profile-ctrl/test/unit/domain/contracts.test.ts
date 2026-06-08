import {
  InvestorProfileSnapshotSchema,
} from '../../../src/domain/contracts';

const validAgentOutput = {
  goals: ['retire at 60', 'fund education'],
  timeHorizon: '20 years',
  riskWillingness: 'high',
  riskScore: 75,
  riskCategory: 'AGGRESSIVE' as const,
  regulatoryFlags: [],
  suitabilityAssessment: 'Suitable for growth-oriented strategies',
  confidence: 0.92,
};

describe('investor-profile-ctrl contracts', () => {
  it('InvestorProfileSnapshotSchema parses a full CDC snapshot subject (dry — identity stays in context)', () => {
    const subject = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentOutput: validAgentOutput,
      sourceEventId: 'evt-abc',
      __version: 3,
    };
    const parsed = InvestorProfileSnapshotSchema.parse(subject);
    // tenantId/userId travel in the event context (RequestContext); zod strips them here.
    expect('tenantId' in parsed).toBe(false);
    expect('userId' in parsed).toBe(false);
    expect(parsed.agentOutput.riskCategory).toBe('AGGRESSIVE');
    expect(parsed.agentOutput.riskScore).toBe(75);
    expect(parsed.sourceEventId).toBe('evt-abc');
    expect(parsed.__version).toBe(3);
  });

  it('sourceEventId and __version are optional', () => {
    const subject = {
      agentOutput: validAgentOutput,
    };
    const parsed = InvestorProfileSnapshotSchema.parse(subject);
    expect(parsed.sourceEventId).toBeUndefined();
    expect(parsed.__version).toBeUndefined();
  });

  it('riskCategory must be one of CONSERVATIVE | MODERATE | AGGRESSIVE', () => {
    const invalidSubject = {
      tenantId: 'tenant-1',
      userId: 'user-1',
      agentOutput: { ...validAgentOutput, riskCategory: 'UNKNOWN' },
    };
    expect(() => InvestorProfileSnapshotSchema.parse(invalidSubject)).toThrow();
  });

  it('agentOutput shape is verified — missing riskScore throws', () => {
    const { riskScore: _omitted, ...withoutRiskScore } = validAgentOutput;
    expect(() =>
      InvestorProfileSnapshotSchema.parse({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: withoutRiskScore,
      }),
    ).toThrow();
  });
});
