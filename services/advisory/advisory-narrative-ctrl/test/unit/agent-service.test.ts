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
}));

import { createAgentService } from '../../src/agent-service';
import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
} from '@nestfolio/agent-orchestrator';

describe('advisory-narrative-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const deps = { docClient, tableName: 'test-table' };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    (resolveAgentRuntimeTarget as jest.Mock).mockResolvedValue(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
    );
  });

  it('dispatches to the AgentCore target and persists IN_PROGRESS + ReasoningOutput + COMPLETED', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      summary: 'Your portfolio was rebalanced to align with your moderate risk profile.',
      rationale: 'Based on market conditions and your investment goals...',
      keyFactors: ['market outlook', 'risk tolerance', 'time horizon'],
      tone: 'educational',
      wordCount: 250,
      confidence: 0.85,
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-narr-1', {
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token',
      context: { riskCategory: 'MODERATE' },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      summary: expect.any(String),
      rationale: expect.any(String),
      keyFactors: expect.any(Array),
      metadata: expect.objectContaining({ modelTier: 'sonnet' }),
    });
    expect(ddbMock).toHaveReceivedCommandTimes(PutCommand, 3);
    expect(dispatchAgentInvocation).toHaveBeenCalledWith(
      expect.stringMatching(/^arn:/),
      expect.objectContaining({
        decisionId: 'dp-1',
        upstreamOutputs: expect.any(Object),
      }),
    );
  });

  it('propagates dispatcher errors', async () => {
    (dispatchAgentInvocation as jest.Mock).mockRejectedValue(new Error('Agent failure'));
    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-narr-2', {
      tenantId: 't1', decisionId: 'dp-2', taskToken: 'token',
    })).rejects.toThrow('Agent failure');
  });

  it('uses INV#${eventId} as the sk and adds attribute_not_exists condition + ttl on IN_PROGRESS write', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      summary: 's', rationale: 'r', keyFactors: [], tone: 'educational', wordCount: 0, confidence: 0,
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-narr-lock', {
      tenantId: 't1',
      decisionId: 'dp-lock',
      taskToken: 'tok',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(3); // IN_PROGRESS + ReasoningOutput + COMPLETED

    const inProgressArgs = calls[0].args[0].input;
    expect(inProgressArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-narr-lock',
      __typename: 'AgentInvocation',
      invocationId: 'evt-narr-lock',
      decisionId: 'dp-lock',
      tenantId: 't1',
      status: 'IN_PROGRESS',
    });
    expect(inProgressArgs.Item?.ttl).toEqual(expect.any(Number));
    expect(inProgressArgs.ConditionExpression).toBe('attribute_not_exists(sk)');

    const completedArgs = calls[2].args[0].input;
    expect(completedArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-narr-lock',
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

    await expect(service.runPipeline('evt-narr-dup', {
      tenantId: 't1',
      decisionId: 'dp-dup',
      taskToken: 'tok',
    })).rejects.toThrow(DuplicateInvocationError);

    expect(dispatchAgentInvocation).not.toHaveBeenCalled();
  });
});
