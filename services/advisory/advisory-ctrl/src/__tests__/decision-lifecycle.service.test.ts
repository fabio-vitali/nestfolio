const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({ send: mockSend })),
    },
    PutCommand: jest.fn().mockImplementation((input) => ({ _type: 'Put', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    TransactWriteCommand: jest.fn().mockImplementation((input) => ({ _type: 'TransactWrite', input })),
  };
});

jest.mock('@nestfolio/platform-core', () => ({
  TableRepository: class {
    protected readonly docClient: { send: jest.Mock };
    protected readonly tableName: string;
    constructor(tableName: string) {
      this.tableName = tableName;
      this.docClient = { send: mockSend };
    }
    protected async put(item: Record<string, unknown>) {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item }));
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix
          ? 'pk = :pk AND begins_with(sk, :sk)'
          : 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk, ...(skPrefix ? { ':sk': skPrefix } : {}) },
      }));
      return result.Items ?? [];
    }
    protected async transactWrite(input: unknown) {
      const { TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new TransactWriteCommand(input));
    }
    protected buildTransactUpdate(pk: string, sk: string, attrs: Record<string, unknown>) {
      const entries = Object.entries(attrs);
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets: string[] = [];
      entries.forEach(([k, v], i) => { names[`#a${i}`] = k; values[`:v${i}`] = v; sets.push(`#a${i} = :v${i}`); });
      return { Update: { TableName: this.tableName, Key: { pk, sk }, UpdateExpression: `SET ${sets.join(', ')}`, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
    }
  },
  getUUID: jest.fn().mockReturnValue('test-uuid'),
  getTime: jest.fn().mockReturnValue('2025-01-01T00:00:00.000Z'),
  log: () => (_target: unknown, _key: string, descriptor: PropertyDescriptor) => descriptor,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

jest.mock('@nestfolio/lambda-utils', () => ({
  withMethodLogging: () => (_name: string, fn: (...args: unknown[]) => unknown) => fn,
}));

jest.mock('@nestfolio/domain-core', () => ({}));

jest.mock('@nestfolio/agent-core', () => ({
  AGENT_TYPES: [
    'user-goals',
    'risk-assessment',
    'market-research',
    'portfolio-construction',
    'rebalance-planner',
    'explainability',
  ],
  createAgentNode: jest.fn().mockReturnValue(jest.fn()),
  invokeGraph: jest.fn().mockResolvedValue({
    'user-goals': {
      goalId: 'g1',
      interpretedObjective: 'Growth',
      timeHorizonMonths: 120,
      targetReturn: 0.08,
      riskBudget: 0.15,
      constraints: [],
      confidence: 0.85,
    },
    'risk-assessment': {
      riskScore: 50,
      riskCategory: 'moderate',
      maxDrawdown: 0.2,
      volatilityBudget: 0.15,
      concentrationLimits: {},
      rationale: 'Moderate',
    },
    'market-research': {
      signals: [
        { ticker: 'VTI', signal: 'buy', strength: 0.7, rationale: 'Core' },
      ],
      marketRegime: 'risk-on',
      sectorRotation: {},
    },
    'portfolio-construction': {
      allocations: [
        { ticker: 'VTI', weight: 0.6, rationale: 'Core' },
        { ticker: 'BND', weight: 0.4, rationale: 'Ballast' },
      ],
      expectedReturn: 0.07,
      expectedVolatility: 0.1,
      sharpeRatio: 0.7,
    },
    'rebalance-planner': {
      trades: [
        { ticker: 'VTI', action: 'buy', quantity: 10, urgency: 'next-session' },
        { ticker: 'BND', action: 'buy', quantity: 8, urgency: 'next-session' },
      ],
      estimatedCost: 5,
      rebalanceReason: 'Initial construction',
    },
    'explainability': {
      summary: 'A balanced portfolio with 60% equities and 40% bonds.',
      keyFactors: ['Risk: moderate'],
      riskWarnings: [],
      confidence: 0.8,
      humanReadableRationale: 'Diversified approach',
    },
    input: JSON.stringify({}),
  }),
  createFallbackNodeMap: jest.fn().mockReturnValue({}),
}));

import { DecisionRepository } from '../repositories/decision.repository';
import { DecisionLifecycleService } from '../services/decision-lifecycle.service';

describe('DecisionLifecycleService', () => {
  let service: DecisionLifecycleService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Each call to mockSend needs to succeed
    mockSend.mockResolvedValue({});
    const repository = new DecisionRepository('test-table');
    service = new DecisionLifecycleService(repository);
  });

  describe('executeDecisionLifecycle', () => {
    it('should execute all stub agents and return completed result', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-1',
          type: 'MANDATE_GRANTED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: { tenantId: 't1' },
          context: { tenantId: 't1' },
        },
        investorProfile: { riskScore: 0.5 },
        portfolioState: {},
      };

      const result = await service.executeDecisionLifecycle(context);

      expect(result.status).toBe('COMPLETED');
      expect(result.decisionPacketId).toBe('test-uuid');
      expect(result.agentOutputs).toBeDefined();
      expect(Object.keys(result.agentOutputs)).toHaveLength(6);
      expect(result.agentOutputs).toHaveProperty('user-goals');
      expect(result.agentOutputs).toHaveProperty('risk-assessment');
      expect(result.agentOutputs).toHaveProperty('market-research');
      expect(result.agentOutputs).toHaveProperty('portfolio-construction');
      expect(result.agentOutputs).toHaveProperty('rebalance-planner');
      expect(result.agentOutputs).toHaveProperty('explainability');
    });

    it('should extract trades from rebalance-planner output', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-2',
          type: 'GOAL_UPDATED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };

      const result = await service.executeDecisionLifecycle(context);

      expect(result.proposedTrades).toHaveLength(2);
      expect(result.proposedTrades[0]).toMatchObject({
        symbol: 'VTI',
        side: 'BUY',
        quantityOrAmountCents: 10,
      });
      expect(result.proposedTrades[1]).toMatchObject({
        symbol: 'BND',
        side: 'BUY',
        quantityOrAmountCents: 8,
      });
    });

    it('should compose explanation from explainability agent output', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-3',
          type: 'RISK_PROFILE_UPDATED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };

      const result = await service.executeDecisionLifecycle(context);

      expect(result.explanation).toContain('balanced portfolio');
      expect(result.explanation).toContain('60% equities');
    });

    it('should record agent invocations and reasoning outputs', async () => {
      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-4',
          type: 'MANDATE_GRANTED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };

      await service.executeDecisionLifecycle(context);

      // 1 createDecisionPacket + (6 agents * 2 calls each = 12) + 1 updateDecisionStatus = 14
      expect(mockSend).toHaveBeenCalledTimes(14);
    });

    it('should propagate error when agent pipeline throws', async () => {
      const { invokeGraph } = require('@nestfolio/agent-core');
      (invokeGraph as jest.Mock).mockRejectedValueOnce(new Error('Agent pipeline timeout'));

      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-err',
          type: 'MANDATE_GRANTED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };

      await expect(service.executeDecisionLifecycle(context)).rejects.toThrow('Agent pipeline timeout');

      // Only createDecisionPacket should have been called (1 DDB call before pipeline)
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw when agent pipeline returns ServiceUnavailableResponse', async () => {
      const { invokeGraph } = require('@nestfolio/agent-core');
      (invokeGraph as jest.Mock).mockResolvedValueOnce({
        serviceUnavailable: true,
        reason: 'Bedrock throttled',
      });

      const context = {
        tenantId: 't1',
        triggerEvent: {
          id: 'evt-unavail',
          type: 'MANDATE_GRANTED',
          timestamp: '2025-01-01T00:00:00.000Z',
          subject: {},
          context: { tenantId: 't1' },
        },
      };

      await expect(service.executeDecisionLifecycle(context)).rejects.toThrow(
        'Agent pipeline unavailable: Bedrock throttled',
      );

      // Only createDecisionPacket should have been called
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });
});
