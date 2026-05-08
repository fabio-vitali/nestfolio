import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

jest.mock('@nestfolio/agent-orchestrator', () => ({
  resolveAgentRuntimeTarget: jest.fn().mockResolvedValue(
    'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
  ),
  dispatchAgentInvocation: jest.fn(),
  DegradedAgentOutputError: jest.requireActual('@nestfolio/agent-orchestrator').DegradedAgentOutputError,
  EmptyAgentResponseError: jest.requireActual('@nestfolio/agent-orchestrator').EmptyAgentResponseError,
  UnknownOperatingModeError: jest.requireActual('@nestfolio/agent-orchestrator').UnknownOperatingModeError,
  assertOrchestratorOutput: jest.requireActual('@nestfolio/agent-orchestrator').assertOrchestratorOutput,
}));

import { createAgentService } from '../../src/agent-service';
import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  DegradedAgentOutputError,
} from '@nestfolio/agent-orchestrator';

describe('investor-profile-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = {
    docClient,
    tableName: 'test-table',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    (resolveAgentRuntimeTarget as jest.Mock).mockResolvedValue(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
    );
  });

  it('dispatches to the AgentCore target and persists IN_PROGRESS + COMPLETED', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: true, output: { goals: ['retirement'], timeHorizon: '10 years', riskWillingness: 'moderate', confidence: 0.9 } },
      'risk-assessment': { ok: true, output: { riskScore: 45, riskCategory: 'MODERATE', regulatoryFlags: [], suitabilityAssessment: 'Suitable', confidence: 0.85 } },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-prof-1', {
      tenantId: 't1',
      decisionId: 'dp-1',
      operatingMode: 'BALANCED',
      taskToken: 'token-123',
      investorProfile: { age: 35 },
      portfolioState: { totalValue: 50000 },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      goals: expect.objectContaining({ goals: ['retirement'] }),
      risk: expect.objectContaining({ riskScore: 45 }),
      metadata: expect.objectContaining({ modelTiers: ['haiku', 'opus'] }),
    });

    // Should have called PutCommand twice (IN_PROGRESS + COMPLETED)
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2);
    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        decisionId: 'dp-1',
        upstreamOutputs: expect.any(Object),
      }),
    );
  });

  it('should propagate dispatcher errors', async () => {
    (dispatchAgentInvocation as jest.Mock).mockRejectedValue(new Error('Agent failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-prof-2', {
      tenantId: 't1',
      decisionId: 'dp-2',
      operatingMode: 'BALANCED',
      taskToken: 'token-456',
    })).rejects.toThrow('Agent failure');
  });

  it('uses INV#${eventId} as the sk and adds attribute_not_exists condition + ttl on IN_PROGRESS write', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: true, output: { goals: [] } },
      'risk-assessment': { ok: true, output: { riskScore: 0 } },
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-prof-lock', {
      tenantId: 't1',
      decisionId: 'dp-lock',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(2);

    const inProgressArgs = calls[0].args[0].input;
    expect(inProgressArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-prof-lock',
      __typename: 'AgentInvocation',
      invocationId: 'evt-prof-lock',
      decisionId: 'dp-lock',
      tenantId: 't1',
      status: 'IN_PROGRESS',
    });
    expect(inProgressArgs.Item?.ttl).toEqual(expect.any(Number));
    expect(inProgressArgs.ConditionExpression).toBe('attribute_not_exists(sk)');

    const completedArgs = calls[1].args[0].input;
    expect(completedArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-prof-lock',
      status: 'COMPLETED',
    });
    expect(completedArgs.ConditionExpression).toBeUndefined();
  });

  it('throws DegradedAgentOutputError when an agent returned ok:false (Phase β fail-fast)', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: true, output: { goals: ['retirement'] } },
      'risk-assessment': { ok: false, reason: 'Error: timeout', fallback: { riskScore: 0 } },
    });
    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-prof-deg', {
      tenantId: 't1',
      decisionId: 'dp-deg',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    })).rejects.toThrow(DegradedAgentOutputError);
  });

  it('throws DuplicateInvocationError when conditional check fails (duplicate event)', async () => {
    const conditionalFailure = new Error('The conditional request failed');
    conditionalFailure.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejectsOnce(conditionalFailure);

    const { DuplicateInvocationError } = await import('../../src/agent-service');
    const service = createAgentService(deps);

    await expect(service.runPipeline('evt-prof-dup', {
      tenantId: 't1',
      decisionId: 'dp-dup',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    })).rejects.toThrow(DuplicateInvocationError);

    expect(dispatchAgentInvocation).not.toHaveBeenCalled();
  });

  // Regression: silent BALANCED fallback was masking the propagation bug
  // tracked in docs/backlog/operating-mode-shape-empty-proposed-trades.md.
  it('throws UnknownOperatingModeError when subject.operatingMode is missing', async () => {
    const { UnknownOperatingModeError } = await import('@nestfolio/agent-orchestrator');
    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-no-mode', {
      tenantId: 't1',
      decisionId: 'dp-no-mode',
      taskToken: 'tok',
    })).rejects.toThrow(UnknownOperatingModeError);

    expect(dispatchAgentInvocation).not.toHaveBeenCalled();
  });

  it('passes operatingMode verbatim into dispatchAgentInvocation upstreamOutputs', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'user-goals': { ok: true, output: { goals: [] } },
      'risk-assessment': { ok: true, output: { riskScore: 0 } },
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-prop', {
      tenantId: 't1',
      decisionId: 'dp-prop',
      operatingMode: 'CONSERVATIVE',
      taskToken: 'tok',
    });

    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        upstreamOutputs: expect.objectContaining({ operatingMode: 'CONSERVATIVE' }),
      }),
    );
  });
});
