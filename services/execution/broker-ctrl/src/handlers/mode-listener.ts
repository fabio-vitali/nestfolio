import { materializeToTable, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { BrokerCtrlInboundEventTypes } from '../domain/events';

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) => {
      const mode = payload.subject.mode as string;
      return record('ExecutionMode', {
        __typename: 'ExecutionMode',
        tenantId: ctx.tenantId,
        mode,
        updatedAt: ctx.timestamp,
      }, {
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
    },
  },
});
