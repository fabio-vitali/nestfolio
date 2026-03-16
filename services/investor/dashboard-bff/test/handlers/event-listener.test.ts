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
    GetCommand: jest.fn().mockImplementation((input) => ({ _type: 'Get', input })),
    QueryCommand: jest.fn().mockImplementation((input) => ({ _type: 'Query', input })),
    UpdateCommand: jest.fn().mockImplementation((input) => ({ _type: 'Update', input })),
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
    protected async putIfNotExists(item: Record<string, unknown>): Promise<boolean> {
      const { PutCommand } = require('@aws-sdk/lib-dynamodb');
      await this.docClient.send(new PutCommand({ TableName: this.tableName, Item: item, ConditionExpression: 'attribute_not_exists(pk)' }));
      return true;
    }
    protected async queryByPk(pk: string, skPrefix?: string) {
      const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
      const result = await this.docClient.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: skPrefix ? 'pk = :pk AND begins_with(sk, :sk)' : 'pk = :pk',
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
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

const mockGuardedWrite = jest.fn().mockResolvedValue(true);

jest.mock('@nestfolio/lambda-utils', () => ({
  requireEnv: (name: string) => process.env[name] ?? name,
  guardedWrite: mockGuardedWrite,
  withMethodLogging: jest.fn().mockImplementation(() =>
    (_methodName: string, fn: (...args: unknown[]) => unknown) => fn,
  ),
}));

process.env.TABLE_NAME = 'test-table';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createHandlers, type EventListenerDeps } from '../../src/handlers/event-listener';
import { DashboardRepository } from '../../src/repositories/dashboard.repository';
import { PortfolioSummaryPipe } from '../../src/pipes/portfolio-summary.pipe';
import { PositionSnapshotPipe } from '../../src/pipes/position-snapshot.pipe';
import { RecentActivityPipe } from '../../src/pipes/recent-activity.pipe';
import { AdvisoryStatusPipe } from '../../src/pipes/advisory-status.pipe';
import { InvestorSnapshotPipe } from '../../src/pipes/investor-snapshot.pipe';
import { TimeTravelAvailabilityPipe } from '../../src/pipes/time-travel-availability.pipe';

describe('dashboard-bff event-listener handler', () => {
  const repository = new DashboardRepository('test-table');

  const portfolioSummaryPipe = new PortfolioSummaryPipe(repository);
  const positionSnapshotPipe = new PositionSnapshotPipe(repository);
  const recentActivityPipe = new RecentActivityPipe(repository);
  const advisoryStatusPipe = new AdvisoryStatusPipe(repository);
  const investorSnapshotPipe = new InvestorSnapshotPipe(repository);
  const timeTravelAvailabilityPipe = new TimeTravelAvailabilityPipe(repository);

  const eventPipeMap: Record<string, { name: string; pipe: any }[]> = {
    BALANCE_UPDATED: [
      { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
      { name: 'recentActivity', pipe: recentActivityPipe },
    ],
    PORTFOLIO_UPDATED: [
      { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
      { name: 'positionSnapshot', pipe: positionSnapshotPipe },
      { name: 'recentActivity', pipe: recentActivityPipe },
    ],
    RECONCILIATION_COMPLETED: [
      { name: 'portfolioSummary', pipe: portfolioSummaryPipe },
    ],
    DECISION_PACKET_CREATED: [
      { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    ],
    USER_CONFIRMATION_REQUESTED: [
      { name: 'advisoryStatus', pipe: advisoryStatusPipe },
    ],
    DECISION_APPROVED: [
      { name: 'advisoryStatus', pipe: advisoryStatusPipe },
      { name: 'recentActivity', pipe: recentActivityPipe },
    ],
    DECISION_BLOCKED: [
      { name: 'advisoryStatus', pipe: advisoryStatusPipe },
      { name: 'recentActivity', pipe: recentActivityPipe },
    ],
    LEDGER_ENTRY_RECORDED: [
      { name: 'timeTravelAvailability', pipe: timeTravelAvailabilityPipe },
    ],
    ONBOARDING_COMPLETED: [
      { name: 'investorSnapshot', pipe: investorSnapshotPipe },
    ],
    GOAL_SET: [
      { name: 'investorSnapshot', pipe: investorSnapshotPipe },
    ],
    GOAL_UPDATED: [
      { name: 'investorSnapshot', pipe: investorSnapshotPipe },
    ],
    RISK_PROFILE_SET: [
      { name: 'investorSnapshot', pipe: investorSnapshotPipe },
    ],
    RISK_PROFILE_UPDATED: [
      { name: 'investorSnapshot', pipe: investorSnapshotPipe },
    ],
  };

  const mockDeps: EventListenerDeps = { eventPipeMap };

  const harness = createTestHarness({
    serviceName: 'dashboard-bff',
    handlers: createHandlers(mockDeps),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({});
    mockGuardedWrite.mockResolvedValue(true);
  });

  it('should process BALANCE_UPDATED event through multiple pipes', async () => {
    const result = await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', {
        tenantId: 't1',
        balanceCents: 1050000,
        deltaCents: 50000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalled();
    expect(mockSend.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('should process DECISION_APPROVED through advisory and activity pipes', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_APPROVED', {
        decisionId: 'd1',
        complianceLevel: 'L1',
        approvedAt: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockGuardedWrite).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should process ONBOARDING_COMPLETED through investor snapshot pipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('ONBOARDING_COMPLETED', {
        tenantId: 't1',
        operatingMode: 'BALANCED',
        riskScore: 7,
        goalId: 'g1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should report failure when DynamoDB throws error during pipe processing', async () => {
    mockSend.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

    const result = await harness.process([
      fakeSqsRecord('BALANCE_UPDATED', {
        tenantId: 't1',
        balanceCents: 1050000,
        deltaCents: 50000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('should skip unknown event types gracefully', async () => {
    const result = await harness.process([
      fakeSqsRecord('UNKNOWN_EVENT', {}, { tenantId: 't1' }),
    ]);
    expect(result.skipped).toBe(1);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should process PORTFOLIO_UPDATED through multiple pipes', async () => {
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1',
        positionCount: 5,
        totalValueCents: 10500000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should process GOAL_UPDATED through investor snapshot pipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('GOAL_UPDATED', {
        goalId: 'g1',
        objective: 'Retirement',
        timeHorizonMonths: 360,
        targetReturn: 0.07,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should handle duplicate events gracefully via per-pipe idempotency (guardedWrite returns false)', async () => {
    mockGuardedWrite.mockResolvedValueOnce(false);

    const result = await harness.process([
      fakeSqsRecord('DECISION_APPROVED', {
        decisionId: 'd1',
        approvedAt: '2025-01-01T00:00:00.000Z',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockGuardedWrite).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalled();
  });

  it('should call all pipes directly without external idempotency guard', async () => {
    const result = await harness.process([
      fakeSqsRecord('PORTFOLIO_UPDATED', {
        tenantId: 't1',
        positionCount: 5,
        totalValueCents: 10500000,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalled();
  });

  it('should process LEDGER_ENTRY_RECORDED through time-travel availability pipe', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await harness.process([
      fakeSqsRecord('LEDGER_ENTRY_RECORDED', {
        tenantId: 't1',
        lastEventSequence: 42,
        version: 5,
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should process DECISION_PACKET_CREATED through advisory pipe', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_PACKET_CREATED', {
        decisionId: 'd1',
        trigger: 'DRIFT',
        tenantId: 't1',
      }, { tenantId: 't1' }),
    ]);
    expect(result.batchItemFailures).toHaveLength(0);
    expect(mockGuardedWrite).toHaveBeenCalledTimes(1);
  });
});
