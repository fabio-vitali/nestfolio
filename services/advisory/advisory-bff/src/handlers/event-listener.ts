import { materializeToTable, toUow } from '@nestfolio/event-processor';
import { AdvisoryCtrlEventTypes } from '@nestfolio/advisory-ctrl/events';
import { ComplianceEventTypes } from '@nestfolio/compliance-ctrl/events';
import { decisionPacketCreated } from '../transforms/decision-packet-created';
import { decisionStatusChanged } from '../transforms/decision-status-changed';

export const handler = materializeToTable({
  serviceName: 'advisory-bff',
  handlers: {
    [AdvisoryCtrlEventTypes.DECISION_PACKET_CREATED]: (payload, ctx) =>
      decisionPacketCreated(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.DECISION_PACKET_ENRICHED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_APPROVED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [ComplianceEventTypes.DECISION_BLOCKED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
    [AdvisoryCtrlEventTypes.USER_CONFIRMATION_REQUESTED]: (payload, ctx) =>
      decisionStatusChanged(toUow(payload, ctx) as any),
  },
  errorEventType: 'ADVISORY_BFF_FAILED',
});
