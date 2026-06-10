import {
  InvestorProfileSnapshotSchema,
} from '../../../src/domain/contracts';
import type { InvestorProfileSnapshotRow } from '../../../src/domain/models';

// Composite agentOutput — the real shape returned by agent-service.ts:
//   { decisionId, goals: GoalInterpretation, risk: RiskEvaluation, metadata }
// The old flat shape (goals[], timeHorizon, riskScore, riskCategory…) was co-wrong with
// the old schema and hid the drift. Corrected 2026-06-10 by the e2e validation gate.
const validAgentOutput = {
  decisionId: 'dec-abc',
  goals: {
    goals: ['retire at 60', 'fund education'],
    timeHorizon: '20 years',
    riskWillingness: 'high',
    confidence: 0.88,
  },
  risk: {
    riskScore: 75,
    riskCategory: 'AGGRESSIVE' as const,
    regulatoryFlags: [],
    suitabilityAssessment: 'Suitable for growth-oriented strategies',
    confidence: 0.92,
  },
  metadata: {
    durationMs: 3200,
    modelTiers: ['haiku', 'sonnet'],
  },
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
    // Composite shape — riskCategory lives inside agentOutput.risk
    expect(parsed.agentOutput.risk.riskCategory).toBe('AGGRESSIVE');
    expect(parsed.agentOutput.risk.riskScore).toBe(75);
    // Goals live inside agentOutput.goals
    expect(parsed.agentOutput.goals.goals).toEqual(['retire at 60', 'fund education']);
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
      agentOutput: {
        ...validAgentOutput,
        risk: { ...validAgentOutput.risk, riskCategory: 'UNKNOWN' },
      },
    };
    expect(() => InvestorProfileSnapshotSchema.parse(invalidSubject)).toThrow();
  });

  it('agentOutput shape is verified — missing risk sub-object throws', () => {
    const { risk: _omitted, ...withoutRisk } = validAgentOutput;
    expect(() =>
      InvestorProfileSnapshotSchema.parse({
        tenantId: 'tenant-1',
        userId: 'user-1',
        agentOutput: withoutRisk,
      }),
    ).toThrow();
  });

  it('agentOutput shape is verified — missing goals sub-object throws', () => {
    const { goals: _omitted, ...withoutGoals } = validAgentOutput;
    expect(() =>
      InvestorProfileSnapshotSchema.parse({
        agentOutput: withoutGoals,
      }),
    ).toThrow();
  });

  it('InvestorProfileSnapshotRow composes TableEntry<InvestorProfileSnapshot, RequestContext>', () => {
    const row: InvestorProfileSnapshotRow = {
      pk: 'InvestorProfileSnapshot#t#u', sk: 'InvestorProfileSnapshot', __typename: 'InvestorProfileSnapshot',
      tenantId: 't' as never, userId: 'u' as never, region: 'us-east-1', createdAt: '2026',
      agentOutput: {
        decisionId: 'dec-1',
        goals: { goals: [], timeHorizon: '5y', riskWillingness: 'moderate', confidence: 0.9 },
        risk: { riskScore: 5, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'ok', confidence: 0.9 },
        metadata: { durationMs: 1000, modelTiers: ['haiku', 'sonnet'] },
      },
      sourceEventType: 'INVESTOR_PROFILE_UPDATED', agentInvocationId: 'inv-1',
    };
    expect(row.__typename).toBe('InvestorProfileSnapshot');
  });
});
