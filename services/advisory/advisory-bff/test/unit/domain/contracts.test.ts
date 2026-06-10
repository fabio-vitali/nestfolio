import { DecisionReadModelSchema, UserConfirmationSchema, UserRejectionSchema } from '../../../src/domain/contracts';

describe('advisory-bff contracts', () => {
  it('DecisionReadModelSchema parses the projected decision read-model subject (full snapshot builder)', () => {
    const parsed = DecisionReadModelSchema.parse({
      tenantId: 't', decisionId: 'd1', trigger: 'DEPOSIT', status: 'GENERATING',
      proposedTrades: [], explanation: '', confirmationRequired: false,
      complianceChecks: [], agentInvocations: [], version: 1, createdAt: '2026', updatedAt: '2026',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.decisionId).toBe('d1');
  });

  it('DecisionReadModelSchema parses the MINIMAL cycle-status row (omitted fields optional)', () => {
    const parsed = DecisionReadModelSchema.parse({
      tenantId: 't', decisionId: 'd1', status: 'GENERATING', trigger: '', version: 0,
      createdAt: '2026', updatedAt: '2026',
    });
    expect(parsed.status).toBe('GENERATING');
    // Anchor the optionality: snapshot-only fields the minimal builder omits must parse to
    // undefined (not defaulted) — a future accidental .default(...) would break this.
    expect(parsed.proposedTrades).toBeUndefined();
    expect(parsed.explanation).toBeUndefined();
    expect(parsed.confirmationRequired).toBeUndefined();
    expect(parsed.complianceChecks).toBeUndefined();
    expect(parsed.agentInvocations).toBeUndefined();
  });

  it('DecisionReadModelSchema parses a real row with rejectionReason:null (gate-proven nullable)', () => {
    // The e2e gate caught a REAL DecisionReadModel row with rejectionReason:null —
    // copied from DecisionPacketSchema's .nullable() source field. The schema MUST
    // accept null (not just undefined) for this field.
    const parsed = DecisionReadModelSchema.parse({
      decisionId: 'd1', trigger: 'DEPOSIT', status: 'APPROVED',
      proposedTrades: [], explanation: 'invest', confirmationRequired: false,
      complianceChecks: [], agentInvocations: [],
      confirmedAt: '2026', rejectedAt: undefined,
      rejectionReason: null, // null — not absent — is what DDB stores for non-rejected decisions
      version: 2, createdAt: '2026', updatedAt: '2026',
    });
    expect(parsed.rejectionReason).toBeNull();
    // confirmedAt/rejectedAt are absent (undefined) on non-rejected rows — not null:
    expect(parsed.rejectedAt).toBeUndefined();
  });

  it('UserConfirmationSchema parses the resolver intent subject (decisionId + taskToken)', () => {
    const parsed = UserConfirmationSchema.parse({
      tenantId: 't', region: 'us-east-1', decisionId: 'd1',
      confirmedAt: '2026', confirmedBy: 'u', timestamp: '2026', taskToken: 'tok',
    });
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.decisionId).toBe('d1');
    expect(parsed.taskToken).toBe('tok');
  });

  it('UserRejectionSchema parses the resolver intent subject (rejectionReason present)', () => {
    expect(UserRejectionSchema.parse({
      tenantId: 't', region: 'us-east-1', decisionId: 'd1',
      rejectedAt: '2026', rejectedBy: 'u', rejectionReason: 'changed mind', timestamp: '2026',
    }).rejectionReason).toBe('changed mind');
  });
});
