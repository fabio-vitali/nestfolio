import { createHandlers } from '../../src/handlers/event-listener';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';

describe('advisory-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(5);
    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED);
    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED);
    expect(handlers).toHaveProperty(ComplianceEventTypes.DECISION_APPROVED);
    expect(handlers).toHaveProperty(ComplianceEventTypes.DECISION_BLOCKED);
    expect(handlers).toHaveProperty(AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED);
  });
});
