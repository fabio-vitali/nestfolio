import { TestBed } from '@angular/core/testing';
import { AdvisoryStore, Decision, AgentInvocation, ComplianceCheck } from './advisory.store';
import { LogoutOrchestrator } from '@nestfolio/shared-state';

const mockDecision: Decision = {
  decisionId: 'dec-001',
  tenantId: 'tenant-1',
  status: 'APPROVED',
  rationale: 'Portfolio needs rebalancing due to drift',
  proposedActions: [
    { actionType: 'MARKET', symbol: 'VWCE.DE', side: 'BUY', quantity: 10, limitPrice: null, currency: 'EUR' },
    { actionType: 'MARKET', symbol: 'AGGH.L', side: 'SELL', quantity: 5, limitPrice: null, currency: 'EUR' },
  ],
  complianceStatus: 'PASSED',
  confirmedAt: null,
  confirmedBy: null,
  rejectedAt: null,
  rejectionReason: null,
  rejectedBy: null,
  version: 1,
  createdAt: '2026-03-01T10:00:00Z',
  updatedAt: '2026-03-01T10:05:00Z',
};

const mockInvocations: AgentInvocation[] = [
  {
    invocationId: 'inv-001',
    decisionId: 'dec-001',
    agentName: 'Portfolio Analyst',
    tier: 'Claude Opus 4.6',
    input: null,
    output: 'Rebalance recommended',
    durationMs: 3200,
    status: 'COMPLETED',
    invokedAt: '2026-03-01T10:00:00Z',
  },
  {
    invocationId: 'inv-002',
    decisionId: 'dec-001',
    agentName: 'Risk Evaluator',
    tier: 'Claude Sonnet 4.6',
    input: null,
    output: 'Risk within bounds',
    durationMs: 1800,
    status: 'COMPLETED',
    invokedAt: '2026-03-01T10:01:00Z',
  },
];

const mockChecks: ComplianceCheck[] = [
  { checkId: 'chk-001', decisionId: 'dec-001', ruleName: 'MaxSingleTrade', result: 'PASSED', details: null, checkedAt: '2026-03-01T10:03:00Z' },
  { checkId: 'chk-002', decisionId: 'dec-001', ruleName: 'MonthlyTurnover', result: 'PASSED', details: null, checkedAt: '2026-03-01T10:03:01Z' },
];

describe('AdvisoryStore', () => {
  let store: InstanceType<typeof AdvisoryStore>;
  let orchestrator: LogoutOrchestrator;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(AdvisoryStore);
    orchestrator = TestBed.inject(LogoutOrchestrator);
    store.reset();
  });

  it('should start with initial state', () => {
    expect(store.decision()).toBeNull();
    expect(store.agentInvocations()).toEqual([]);
    expect(store.complianceChecks()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should set decision', () => {
    store.setDecision(mockDecision);
    expect(store.decision()).toEqual(mockDecision);
    expect(store.isLoaded()).toBe(true);
  });

  it('should compute headline from first proposed action', () => {
    store.setDecision(mockDecision);
    expect(store.headline()).toBe('BUY VWCE.DE');
  });

  it('should compute headline from rationale when no actions', () => {
    store.setDecision({ ...mockDecision, proposedActions: [] });
    expect(store.headline()).toBe('Portfolio needs rebalancing due to drift');
  });

  it('should compute statusSeverity for APPROVED', () => {
    store.setDecision(mockDecision);
    expect(store.statusSeverity()).toBe('success');
  });

  it('should compute statusSeverity for BLOCKED', () => {
    store.setDecision({ ...mockDecision, status: 'BLOCKED' });
    expect(store.statusSeverity()).toBe('danger');
  });

  it('should compute statusSeverity for AWAITING_CONFIRMATION', () => {
    store.setDecision({ ...mockDecision, status: 'AWAITING_CONFIRMATION' });
    expect(store.statusSeverity()).toBe('warn');
  });

  it('should set agent invocations', () => {
    store.setAgentInvocations(mockInvocations);
    expect(store.agentInvocations()).toHaveLength(2);
  });

  it('should compute model versions', () => {
    store.setAgentInvocations(mockInvocations);
    expect(store.modelVersions()).toEqual(['Claude Opus 4.6', 'Claude Sonnet 4.6']);
  });

  it('should compute total duration', () => {
    store.setAgentInvocations(mockInvocations);
    expect(store.totalDurationMs()).toBe(5000);
  });

  it('should set compliance checks', () => {
    store.setComplianceChecks(mockChecks);
    expect(store.complianceChecks()).toHaveLength(2);
  });

  it('should compute compliancePassed as true when all pass', () => {
    store.setComplianceChecks(mockChecks);
    expect(store.compliancePassed()).toBe(true);
  });

  it('should compute compliancePassed as false when any fails', () => {
    store.setComplianceChecks([
      ...mockChecks,
      { checkId: 'chk-003', decisionId: 'dec-001', ruleName: 'ConcentrationLimit', result: 'FAILED', details: 'Over 30%', checkedAt: '2026-03-01T10:03:02Z' },
    ]);
    expect(store.compliancePassed()).toBe(false);
  });

  it('should compute compliancePassed as null when no checks', () => {
    expect(store.compliancePassed()).toBeNull();
  });

  it('should set loading', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);
  });

  it('should set error', () => {
    store.setError('Something went wrong');
    expect(store.error()).toBe('Something went wrong');
  });

  it('should reset to initial state', () => {
    store.setDecision(mockDecision);
    store.setAgentInvocations(mockInvocations);
    store.setComplianceChecks(mockChecks);
    store.setLoading(true);
    store.setError('err');

    store.reset();

    expect(store.decision()).toBeNull();
    expect(store.agentInvocations()).toEqual([]);
    expect(store.complianceChecks()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('should reset on logout via orchestrator', () => {
    store.setDecision(mockDecision);
    store.setAgentInvocations(mockInvocations);
    store.setComplianceChecks(mockChecks);
    store.setLoading(true);

    orchestrator.resetAll();

    expect(store.decision()).toBeNull();
    expect(store.agentInvocations()).toEqual([]);
    expect(store.complianceChecks()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('should expose callState-based loading/error signals', () => {
    store.setLoading(true);
    expect(store.loading()).toBe(true);

    store.setLoading(false);
    expect(store.loaded()).toBe(true);

    store.setError('fail');
    expect(store.error()).toBe('fail');
  });
});
