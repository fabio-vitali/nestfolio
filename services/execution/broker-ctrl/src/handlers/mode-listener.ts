import '../read-model-ownership';
import { materializeToTable, parseSubject, record, type EventPayload, type EventContext } from '@nestfolio/event-processor';
import { ExecutionModeChangedSchema } from '@nestfolio/investor-adpt/domain';
import { BrokerCtrlInboundEventTypes } from '../domain/events';
import type { ExecutionMode } from '../domain/contracts';

export const handler = materializeToTable({
  serviceName: 'broker-ctrl',
  handlers: {
    [BrokerCtrlInboundEventTypes.EXECUTION_MODE_CHANGED]: (payload: EventPayload, ctx: EventContext) => {
      const subject = parseSubject(payload, ExecutionModeChangedSchema);
      // ExecutionModeChangedSchema carries toMode (the new mode after the change).
      // The ExecutionMode cache stores the current mode — toMode is the correct value to cache.
      const executionMode: ExecutionMode = {
        mode: subject.toMode,
        updatedAt: ctx.timestamp,
      };
      return record('ExecutionMode', {
        __typename: 'ExecutionMode',
        tenantId: ctx.tenantId,
        ...executionMode,
      }, {
        pk: `ExecutionMode#${ctx.tenantId}`,
        sk: 'ExecutionMode',
      });
    },
  },
});
