import { createCdcTestHarness, fakeDdbStreamRecord, buildEventTypeMap } from '@nestfolio/event-processor';

const eventTypeMap = buildEventTypeMap(['ComplianceCheck', 'AuditArtifact']);

describe('compliance-ctrl event-publisher', () => {
  const harness = createCdcTestHarness({ serviceName: 'compliance-ctrl', eventTypeMap });

  it('publishes COMPLIANCE_CHECK_CREATED for ComplianceCheck INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'ComplianceCheck', tenantId: 't1', status: 'COMPLETED' }),
    ]);
    expect(result.publishedEvents).toHaveLength(1);
    expect(result.publishedEvents[0].eventType).toBe('COMPLIANCE_CHECK_CREATED');
  });

  it('publishes AUDIT_ARTIFACT_CREATED for AuditArtifact INSERT', async () => {
    const result = await harness.process([
      fakeDdbStreamRecord('INSERT', { __typename: 'AuditArtifact', tenantId: 't1' }),
    ]);
    expect(result.publishedEvents[0].eventType).toBe('AUDIT_ARTIFACT_CREATED');
  });
});
