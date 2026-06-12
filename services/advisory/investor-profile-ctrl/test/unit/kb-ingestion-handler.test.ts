import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { BedrockAgentClient, StartIngestionJobCommand } from '@aws-sdk/client-bedrock-agent';

const bedrockMock = mockClient(BedrockAgentClient);

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({ send: jest.fn() })),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  ...jest.requireActual('@aws-sdk/lib-dynamodb'),
  DynamoDBDocumentClient: { from: jest.fn().mockImplementation(() => ({ send: jest.fn() })) },
}));

jest.mock('@nestfolio/event-processor', () => ({
  ...jest.requireActual('@nestfolio/event-processor'),
  requireEnv: (name: string) => process.env[name] ?? name,
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

process.env.KB_BUCKET = 'test-kb-bucket';
process.env.KB_ID = 'test-kb-id';
process.env.KB_DATA_SOURCE_ID = 'test-ds-id';

import { createTestHarness, fakeSqsRecord } from '@nestfolio/event-processor';
import { createKbIngestionHandlers, type KbIngestionDeps } from '../../src/handlers/kb-ingestion-handler';

/** Minimal valid ComplianceCheck subject as produced by compliance-ctrl CDC. */
const validComplianceCheck = {
  ccId: 'cc-1',
  decisionPacketId: 'dp-1',
  decisionId: 'dp-1',
  taskToken: 'tok-abc',
  mandateSnapshot: {
    level: 'ADVISORY' as const,
    status: 'ACTIVE' as const,
    operatingMode: 'BALANCED' as const,
    effectiveDate: '2026-01-01',
  },
  status: 'BLOCKED' as const,
  result: 'BLOCKED' as const,
  violations: [{ rule: 'MAX_EQUITY_EXPOSURE', description: 'Exceeds risk limits', severity: 'BLOCKING' as const }],
  authorityLevel: 'L1' as const,
  sourceEventId: 'src-1',
};

const validApprovedCheck = {
  ...validComplianceCheck,
  decisionPacketId: 'dp-2',
  decisionId: 'dp-2',
  status: 'COMPLETED' as const,
  result: 'APPROVED' as const,
  violations: [],
  authorityLevel: 'L1' as const,
};

describe('investor-profile-ctrl kb-ingestion-handler', () => {
  const bedrockAgent = new BedrockAgentClient({});

  const mockDeps: KbIngestionDeps = {
    bedrockAgent,
    kbId: 'test-kb-id',
    kbDataSourceId: 'test-ds-id',
  };

  const harness = createTestHarness({
    serviceName: 'investor-profile-ctrl-kb',
    handlers: createKbIngestionHandlers(mockDeps),
  });

  beforeEach(() => {
    bedrockMock.reset();
    bedrockMock.on(StartIngestionJobCommand).resolves({});
  });

  it('should return store intent for DECISION_BLOCKED and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', validComplianceCheck, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({
      _tag: 'store',
      key: expect.stringMatching(/^compliance\/decision_blocked\//),
    });
    expect(bedrockMock).toHaveReceivedCommandWith(StartIngestionJobCommand, {
      knowledgeBaseId: 'test-kb-id',
      dataSourceId: 'test-ds-id',
    });
  });

  it('narrative for DECISION_BLOCKED contains violation description', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', validComplianceCheck, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    // The store intent body should reference violation description and authority
    const intent = result.intents[0] as { _tag: string; body: string };
    expect(intent.body).toContain('Exceeds risk limits');
    expect(intent.body).toContain('L1');
    expect(intent.body).not.toContain('undefined');
  });

  it('should return store intent for DECISION_APPROVED and trigger KB sync', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_APPROVED', validApprovedCheck, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(0);
    expect(result.intents).toHaveLength(1);
    expect(result.intents[0]).toMatchObject({ _tag: 'store' });
    expect(bedrockMock).toHaveReceivedCommand(StartIngestionJobCommand);
  });

  it('should throw ZodError (batchItemFailure) when subject does not match ComplianceCheckSchema', async () => {
    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', {
        // missing required fields: ccId, taskToken, mandateSnapshot, violations, etc.
        decisionId: 'dp-bad',
      }, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });

  it('should report failure when Bedrock sync throws', async () => {
    bedrockMock.on(StartIngestionJobCommand).rejects(new Error('Bedrock sync failed'));

    const result = await harness.process([
      fakeSqsRecord('DECISION_BLOCKED', validComplianceCheck, { tenantId: 't1' }),
    ]);

    expect(result.batchItemFailures).toHaveLength(1);
  });
});
