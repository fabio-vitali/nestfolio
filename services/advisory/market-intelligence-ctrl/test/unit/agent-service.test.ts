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
  assertOrchestratorOutput: jest.requireActual('@nestfolio/agent-orchestrator').assertOrchestratorOutput,
}));

import { createAgentService } from '../../src/agent-service';
import {
  resolveAgentRuntimeTarget,
  dispatchAgentInvocation,
  DegradedAgentOutputError,
} from '@nestfolio/agent-orchestrator';

describe('market-intelligence-ctrl agent-service', () => {
  const docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const noopMemoryClient = {
    openDecisionSession: jest.fn().mockReturnValue({
      emitLongTermEvent: jest.fn().mockResolvedValue(undefined),
      searchLongTermMemory: jest.fn().mockResolvedValue([]),
    }),
    searchTenantMemory: jest.fn().mockResolvedValue([]),
  };
  const deps = {
    docClient,
    tableName: 'test-table',
    memoryClient: noopMemoryClient,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    (resolveAgentRuntimeTarget as jest.Mock).mockResolvedValue(
      'arn:aws:bedrock-agentcore:us-east-1:111122223333:runtime/test',
    );
  });

  it('should dispatch to AgentCore target and persist IN_PROGRESS + COMPLETED', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'market-research': {
        ok: true,
        output: {
          signals: [{ type: 'momentum', ticker: 'SPY', sentiment: 'BULLISH', confidence: 0.8, source: 'technical' }],
          tickersMentioned: ['SPY'],
          marketOutlook: 'Bullish momentum in US equities',
          confidenceScore: 0.85,
        },
      },
    });

    const service = createAgentService(deps);
    const result = await service.runPipeline('evt-mkt-1', {
      tenantId: 't1',
      decisionId: 'dp-1',
      taskToken: 'token-123',
      upstreamOutputs: { investorProfile: { riskScore: 45 } },
    });

    expect(result).toMatchObject({
      decisionId: 'dp-1',
      signals: expect.arrayContaining([expect.objectContaining({ ticker: 'SPY' })]),
      tickersMentioned: ['SPY'],
      marketOutlook: 'Bullish momentum in US equities',
      confidenceScore: 0.85,
      metadata: expect.objectContaining({ modelTier: 'sonnet' }),
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
    await expect(service.runPipeline('evt-mkt-2', {
      tenantId: 't1',
      decisionId: 'dp-2',
      taskToken: 'token-456',
    })).rejects.toThrow('Agent failure');
  });

  it('uses INV#${eventId} as the sk and adds attribute_not_exists condition + ttl on IN_PROGRESS write', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'market-research': {
        ok: true,
        output: { signals: [], tickersMentioned: [], marketOutlook: '', confidenceScore: 0 },
      },
    });

    const service = createAgentService(deps);
    await service.runPipeline('evt-mkt-lock', {
      tenantId: 't1',
      decisionId: 'dp-lock',
      taskToken: 'tok',
    });

    const calls = ddbMock.commandCalls(PutCommand);
    expect(calls.length).toBe(2);

    const inProgressArgs = calls[0].args[0].input;
    expect(inProgressArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-mkt-lock',
      __typename: 'AgentInvocation',
      invocationId: 'evt-mkt-lock',
      decisionId: 'dp-lock',
      tenantId: 't1',
      status: 'IN_PROGRESS',
    });
    expect(inProgressArgs.Item?.ttl).toEqual(expect.any(Number));
    expect(inProgressArgs.ConditionExpression).toBe('attribute_not_exists(sk)');

    const completedArgs = calls[1].args[0].input;
    expect(completedArgs.Item).toMatchObject({
      pk: 'DECISION#dp-lock',
      sk: 'INV#evt-mkt-lock',
      status: 'COMPLETED',
    });
    expect(completedArgs.ConditionExpression).toBeUndefined();
  });

  it('throws DegradedAgentOutputError when market-research returned ok:false (Phase β fail-fast)', async () => {
    (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
      'market-research': { ok: false, reason: 'Error: timeout', fallback: { signals: [] } },
    });
    const service = createAgentService(deps);
    await expect(service.runPipeline('evt-mkt-deg', {
      tenantId: 't1',
      decisionId: 'dp-deg',
      taskToken: 'tok',
    })).rejects.toThrow(DegradedAgentOutputError);
  });

  it('throws DuplicateInvocationError when conditional check fails (duplicate event)', async () => {
    const conditionalFailure = new Error('The conditional request failed');
    conditionalFailure.name = 'ConditionalCheckFailedException';
    ddbMock.on(PutCommand).rejectsOnce(conditionalFailure);

    const { DuplicateInvocationError } = await import('../../src/agent-service');
    const service = createAgentService(deps);

    await expect(service.runPipeline('evt-mkt-dup', {
      tenantId: 't1',
      decisionId: 'dp-dup',
      taskToken: 'tok',
    })).rejects.toThrow(DuplicateInvocationError);

    expect(dispatchAgentInvocation).not.toHaveBeenCalled();
  });

  describe('Phase B — emitLongTermEvent integration', () => {
    it('emits one event to signals namespace after successful validation', async () => {
      (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
        'market-research': {
          ok: true,
          output: { signals: [{ sector: 'TECH', strength: 0.8 }], tickersMentioned: [], marketOutlook: '', confidenceScore: 0 },
        },
      });

      const emitMock = jest.fn().mockResolvedValue(undefined);
      const memoryClient = {
        openDecisionSession: jest.fn().mockReturnValue({
          emitLongTermEvent: emitMock,
          searchLongTermMemory: jest.fn().mockResolvedValue([]),
        }),
        searchTenantMemory: jest.fn().mockResolvedValue([]),
      };

      const service = createAgentService({ ...deps, memoryClient });
      await service.runPipeline('evt-1', {
        tenantId: 't1',
        decisionId: 'd1',
        operatingMode: 'BALANCED',
        taskToken: 'tok',
      });

      expect(memoryClient.openDecisionSession).toHaveBeenCalledWith('t1', 'd1');
      expect(emitMock).toHaveBeenCalledTimes(1);
      expect(emitMock).toHaveBeenCalledWith({
        namespace: 'signals',
        payload: expect.objectContaining({
          marketResearch: expect.objectContaining({ signals: expect.any(Array) }),
        }),
      });
    });

    it('does NOT emit when output is degraded', async () => {
      (dispatchAgentInvocation as jest.Mock).mockResolvedValue({
        'market-research': { ok: false, reason: 'timeout' },
      });

      const emitMock = jest.fn().mockResolvedValue(undefined);
      const memoryClient = {
        openDecisionSession: jest.fn().mockReturnValue({
          emitLongTermEvent: emitMock,
          searchLongTermMemory: jest.fn().mockResolvedValue([]),
        }),
        searchTenantMemory: jest.fn().mockResolvedValue([]),
      };

      const service = createAgentService({ ...deps, memoryClient });
      await expect(
        service.runPipeline('evt-2', { tenantId: 't1', decisionId: 'd2', operatingMode: 'BALANCED', taskToken: 'tok' }),
      ).rejects.toThrow();
      expect(emitMock).not.toHaveBeenCalled();
    });
  });
});
