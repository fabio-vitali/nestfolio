import {
  DecisionPacketSchema, MandateSnapshotSchema, RecommendationProposedSchema,
  DecisionCycleStartedSchema, DecisionCycleFailedSchema,
} from '../../../src/domain/contracts';

describe('decision-workflow-ctrl contracts', () => {
  it('DecisionPacketSchema parses a PENDING packet (dry — identity stripped)', () => {
    const parsed = DecisionPacketSchema.parse({
      decisionId: 'd1', trigger: 'DEPOSIT', triggerEventId: 'e1', executionArn: null,
      explanation: '', proposedTrades: [], confirmationRequired: false, status: 'PENDING',
      __version: 1, complianceResult: null, authorityLevel: null, userDecision: null,
      blockReason: null, rejectionReason: null, timestamp: '2026', createdAt: '2026', updatedAt: '2026',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.status).toBe('PENDING');
  });

  it('RecommendationProposedSchema parses the SF-direct subject', () => {
    const parsed = RecommendationProposedSchema.parse({
      decisionId: 'd1', taskToken: 'tok', awaitingCompliance: true,
      proposedTrades: [], portfolioValueCents: 100000, isInitialBuild: true,
      riskCategory: 'MODERATE', currentPositions: [],
    });
    expect(parsed.awaitingCompliance).toBe(true);
  });

  it('DecisionCycleStartedSchema parses GENERATING(v0); DecisionCycleFailedSchema parses FAILED(v1)', () => {
    expect(DecisionCycleStartedSchema.parse({ decisionId: 'd1', status: 'GENERATING', __version: 0 }).status).toBe('GENERATING');
    expect(DecisionCycleFailedSchema.parse({ decisionId: 'd1', status: 'FAILED', __version: 1 }).status).toBe('FAILED');
  });

  it('MandateSnapshotSchema parses the mandate mirror subject', () => {
    expect(MandateSnapshotSchema.parse({
      mandateId: 'm1', level: 'ADVISORY', operatingMode: 'CONSERVATIVE', effectiveDate: '2026', status: 'ACTIVE',
    }).operatingMode).toBe('CONSERVATIVE');
  });
});
