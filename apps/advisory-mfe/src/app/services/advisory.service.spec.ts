import { TestBed } from '@angular/core/testing';
import { AdvisoryService } from './advisory.service';

jest.mock('@nestfolio/appsync-client', () => ({
  query: jest.fn(),
  mutate: jest.fn(),
  GET_DECISION: 'GET_DECISION',
  GET_AGENT_INVOCATIONS: 'GET_AGENT_INVOCATIONS',
  GET_COMPLIANCE_CHECKS: 'GET_COMPLIANCE_CHECKS',
  RECORD_EXPLANATION_VIEW: 'RECORD_EXPLANATION_VIEW',
}));

import { query, mutate } from '@nestfolio/appsync-client';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockMutate = mutate as jest.MockedFunction<typeof mutate>;

describe('AdvisoryService', () => {
  let service: AdvisoryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AdvisoryService);
    jest.clearAllMocks();
  });

  it('should call getDecision', async () => {
    const decision = { decisionId: 'dec-001', status: 'APPROVED' };
    mockQuery.mockResolvedValue({ getDecision: decision } as never);

    const result = await service.getDecision('dec-001');
    expect(result).toEqual(decision);
    expect(mockQuery).toHaveBeenCalledWith('GET_DECISION', { decisionId: 'dec-001' });
  });

  it('should call getAgentInvocations', async () => {
    const invocations = [{ invocationId: 'inv-001' }];
    mockQuery.mockResolvedValue({ getAgentInvocations: invocations } as never);

    const result = await service.getAgentInvocations('dec-001');
    expect(result).toEqual(invocations);
    expect(mockQuery).toHaveBeenCalledWith('GET_AGENT_INVOCATIONS', { decisionId: 'dec-001' });
  });

  it('should call getComplianceChecks', async () => {
    const checks = [{ checkId: 'chk-001' }];
    mockQuery.mockResolvedValue({ getComplianceChecks: checks } as never);

    const result = await service.getComplianceChecks('dec-001');
    expect(result).toEqual(checks);
    expect(mockQuery).toHaveBeenCalledWith('GET_COMPLIANCE_CHECKS', { decisionId: 'dec-001' });
  });

  it('should call recordExplanationView', async () => {
    mockMutate.mockResolvedValue({} as never);

    await service.recordExplanationView('dec-001');
    expect(mockMutate).toHaveBeenCalledWith('RECORD_EXPLANATION_VIEW', { decisionId: 'dec-001' });
  });
});
