import { ComplianceCheckSchema } from '../../../src/domain/contracts';

describe('compliance-ctrl contracts', () => {
  it('ComplianceCheckSchema parses an APPROVED check subject (dry — identity stripped)', () => {
    const row = {
      pk: 'ComplianceCheck#t#cc1', sk: 'ComplianceCheck', __typename: 'ComplianceCheck',
      tenantId: 't', ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1',
      taskToken: 'tok', mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026-06-10T00:00:00.000Z' },
      status: 'COMPLETED', result: 'APPROVED', violations: [], authorityLevel: 'L1', sourceEventId: 'e1',
    };
    const parsed = ComplianceCheckSchema.parse(row);
    expect('tenantId' in parsed).toBe(false);
    expect(parsed.result).toBe('APPROVED');
    expect(parsed.ccId).toBe('cc1');
  });

  it('ComplianceCheckSchema parses a BLOCKED check with violations', () => {
    const parsed = ComplianceCheckSchema.parse({
      ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1', taskToken: 'tok',
      mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026' },
      status: 'BLOCKED', result: 'BLOCKED',
      violations: [{ rule: 'MANDATE_MISSING', description: 'No mandate', severity: 'BLOCKING' }],
      authorityLevel: 'L2', sourceEventId: 'e1',
    });
    expect(parsed.violations[0].severity).toBe('BLOCKING');
  });

  it('ComplianceCheckSchema parses an engine-evaluated BLOCKED check (status COMPLETED, result BLOCKED)', () => {
    // The common production blocked case: the rule engine ran (status=COMPLETED)
    // and returned result=BLOCKED — distinct from the mandate-missing fallback,
    // which short-circuits to status=BLOCKED before evaluation.
    const parsed = ComplianceCheckSchema.parse({
      ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1', taskToken: 'tok',
      mandateSnapshot: { level: 'DISCRETIONARY', status: 'ACTIVE', operatingMode: 'BALANCED', effectiveDate: '2026' },
      status: 'COMPLETED', result: 'BLOCKED',
      violations: [{ rule: 'MANDATE_VIOLATION', description: 'Over cap', severity: 'BLOCKING' }],
      authorityLevel: 'L2', sourceEventId: 'e1',
    });
    expect(parsed.status).toBe('COMPLETED');
    expect(parsed.result).toBe('BLOCKED');
  });

  it('ComplianceCheckSchema rejects an unknown result', () => {
    expect(() => ComplianceCheckSchema.parse({
      ccId: 'cc1', decisionPacketId: 'dp1', decisionId: 'dp1', taskToken: 'tok',
      mandateSnapshot: { level: 'ADVISORY', status: 'ACTIVE', operatingMode: 'CONSERVATIVE', effectiveDate: '2026' },
      status: 'COMPLETED', result: 'ESCALATED', violations: [], authorityLevel: 'L1', sourceEventId: 'e1',
    })).toThrow();
  });
});
