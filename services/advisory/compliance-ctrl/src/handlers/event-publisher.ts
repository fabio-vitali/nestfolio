import { changeDataCapture, buildEventTypeMap } from '@nestfolio/event-processor';

export const handler = changeDataCapture({
  serviceName: 'compliance-ctrl',
  eventTypeMap: buildEventTypeMap(['ComplianceCheck', 'AuditArtifact']),
});
