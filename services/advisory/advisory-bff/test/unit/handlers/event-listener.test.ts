import { createHandlers } from '../../../src/handlers/event-listener';
import { DecisionWorkflowEventTypes } from '@nestfolio/decision-workflow-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';

describe('advisory-bff event-listener', () => {
  it('should export handlers for all event types', () => {
    const handlers = createHandlers();

    expect(Object.keys(handlers)).toHaveLength(5);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_CREATED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.DECISION_PACKET_UPDATED);
    expect(handlers).toHaveProperty(ComplianceEventTypes.DECISION_APPROVED);
    expect(handlers).toHaveProperty(ComplianceEventTypes.DECISION_BLOCKED);
    expect(handlers).toHaveProperty(DecisionWorkflowEventTypes.USER_CONFIRMATION_REQUESTED);
  });
});
