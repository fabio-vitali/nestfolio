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

describe('portfolio-engine-ctrl agent-service', () => {
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

  it('should dispatch to AgentCore and return allocations + trades', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [{ instrument: 'VTI', targetWeight: 0.6 }] } },
      'rebalance-planner': { ok: true, output: { trades: [{ action: 'BUY', instrument: 'VTI' }] } },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-1', {
      tenantId: 't1',
      decisionId: 'dp-1',
      operatingMode: 'BALANCED',
      taskToken: 'token',
      context: { riskCategory: 'MODERATE' },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      allocations: expect.objectContaining({ allocations: expect.any(Array) }),
      trades: expect.objectContaining({ trades: expect.any(Array) }),
      metadata: expect.objectContaining({ modelTiers: ['opus', 'sonnet'] }),
    });
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 2); // IN_PROGRESS + COMPLETED
    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({ decisionId: 'dp-1' }),
    );
  });

  it('throws DegradedAgentOutputError when an agent returned ok:false (Phase β fail-fast)', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [] } },
      'rebalance-planner': { ok: false, reason: 'Error: timeout', fallback: { trades: [] } },
    });

    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-deg', {
      tenantId: 't1',
      decisionId: 'dp-deg',
      operatingMode: 'BALANCED',
      taskToken: 'token',
    })).rejects.toThrow(DegradedAgentOutputError);
  });

  it('should propagate dispatcher errors', async () => {
    (dispatchAgentInvocation as jest.Mock).mockRejectedValue(new Error('Agent failure'));

    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-2', {
      tenantId: 't1', decisionId: 'dp-2', operatingMode: 'BALANCED', taskToken: 'token',
    })).rejects.toThrow('Agent failure');
  });

  it('uses INV#${eventId} as the sk and adds attribute_not_exists condition + ttl on IN_PROGRESS write', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'portfolio-construction': { ok: true, output: { allocations: [] } },
      'rebalance-planner': { ok: true, output: { trades: [] } },
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-lock-1', {
      tenantId: 't1',
      decisionId: 'dp-lock',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    });

    // First PutCommand should be the IN_PROGRESS lock acquisition
    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(2); // IN_PROGRESS + COMPLETED

    const inProgressArgs = calls[0].args[0].input;
    expect(inProgressArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-lock-1',
      __typename: 'AgentInvocation',
      invocationId: 'evt-lock-1',
      decisionId: 'dp-lock',
      tenantId: 't1',
      status: 'IN_PROGRESS',
    });
    expect(inProgressArgs.Item?.ttl).toEqual(expect.any(Number));
    expect(inProgressArgs.ConditionExpression).toBe('attribute_not_exists(sk)');

    // Second PutCommand is the COMPLETED overwrite — same sk, no condition
    const completedArgs = calls[1].args[0].input;
    expect(completedArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-lock-1',
      status: 'COMPLETED',
    });
    expect(completedArgs.ConditionExpression).toBeUndefined();
  });

  it('throws DuplicateInvocationError when conditional check fails (duplicate event)', async () => {
    const conditionalFailure = new Error('The conditional request failed');
    conditionalFailure.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejectsOnce(conditionalFailure);

    const { DuplicateInvocationError } = await import('../../src/agent-service');
    const service = createAgentService(deps);

    await expect(service.runPipeline('evt-dup', {
      tenantId: 't1',
      decisionId: 'dp-dup',
      operatingMode: 'BALANCED',
      taskToken: 'tok',
    })).rejects.toThrow(DuplicateInvocationError);

    // AgentCore must NOT have been called on the duplicate
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
      'portfolio-construction': { ok: true, output: { allocations: [] } },
      'rebalance-planner': { ok: true, output: { trades: [] } },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-prop', {
      tenantId: 't1',
      decisionId: 'dp-prop',
      operatingMode: 'AGGRESSIVE',
      taskToken: 'tok',
    });

    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        upstreamOutputs: expect.objectContaining({ operatingMode: 'AGGRESSIVE' }),
      }),
    );
    expect(result.metadata).toMatchObject({ modeUsed: 'AGGRESSIVE' });
  });
});
