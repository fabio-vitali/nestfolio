import '../read-model-ownership';
import { materializeToTable, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes } from '../domain/events';
import type { ExecutionMode } from '../domain/contracts';

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) => {
      const subject: ExecutionMode = {
        mode: payload.subject.mode as ExecutionMode['mode'],
        updatedAt: ctx.timestamp,
      };
      return record('ExecutionMode', {
        __typename: 'ExecutionMode',
        tenantId: ctx.tenantId,
        ...subject,
      }, {
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
    },
  },
});
